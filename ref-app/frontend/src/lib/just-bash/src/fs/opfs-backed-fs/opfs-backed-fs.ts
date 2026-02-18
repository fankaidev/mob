/**
 * OPFS-backed filesystem wrapper.
 *
 * Delegates all operations to an InMemoryFs and asynchronously persists
 * state to the Origin Private File System so files survive page refreshes.
 */

import { InMemoryFs } from "../in-memory-fs/in-memory-fs";
import type {
	BufferEncoding,
	CpOptions,
	DirentEntry,
	FileContent,
	FsStat,
	IFileSystem,
	MkdirOptions,
	ReadFileOptions,
	RmOptions,
	WriteFileOptions,
} from "../interface";

// Paths recreated by initFilesystem every session — no need to persist.
const SYSTEM_PREFIXES = ["/dev/", "/proc/", "/bin/", "/usr/bin/"];
const OPFS_DIR = "bash-fs";
const OPFS_FILE = "state.json";
const SAVE_DEBOUNCE_MS = 200;
const STATE_VERSION = 1;

interface SerializedEntry {
	type: "file" | "directory" | "symlink";
	/** base64-encoded content (files only) */
	content?: string;
	/** symlink target */
	target?: string;
	mode: number;
	mtime: number; // epoch ms
}

interface SerializedState {
	version: number;
	entries: Record<string, SerializedEntry>;
}

function shouldPersist(path: string): boolean {
	if (path === "/") return false;
	return !SYSTEM_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
}

// ---------- helpers for base64 <-> Uint8Array ----------

function uint8ToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export class OpfsBackedFs implements IFileSystem {
	private inner!: InMemoryFs;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private opfsDir!: FileSystemDirectoryHandle;
	private visibilityHandler: (() => void) | null = null;

	/* Prevent direct construction — use OpfsBackedFs.create() */
	private constructor() {}

	// ---- factory ----

	static async create(): Promise<OpfsBackedFs> {
		const self = new OpfsBackedFs();
		self.inner = new InMemoryFs();

		// Open (or create) the OPFS directory
		const root = await navigator.storage.getDirectory();
		self.opfsDir = await root.getDirectoryHandle(OPFS_DIR, { create: true });

		// Load persisted state into the inner fs
		await self.load();

		// Ensure /home/user exists
		self.inner.mkdirSync("/home/user", { recursive: true });

		// Flush on tab hide / close
		self.visibilityHandler = () => {
			if (document.visibilityState === "hidden") {
				self.flushSync();
			}
		};
		document.addEventListener("visibilitychange", self.visibilityHandler);

		return self;
	}

	// ---- persistence ----

	private async load(): Promise<void> {
		let file: FileSystemFileHandle;
		try {
			file = await this.opfsDir.getFileHandle(OPFS_FILE);
		} catch {
			return; // no saved state yet
		}

		const blob = await file.getFile();
		const text = await blob.text();
		if (!text) return;

		let state: SerializedState;
		try {
			state = JSON.parse(text);
		} catch {
			return; // corrupt — start fresh
		}
		if (state.version !== STATE_VERSION) return;

		const entries = Object.entries(state.entries);

		// Sort directories by depth (shallowest first) so parents exist before children.
		const dirs = entries
			.filter(([, e]) => e.type === "directory")
			.sort(([a], [b]) => a.split("/").length - b.split("/").length);

		for (const [path] of dirs) {
			this.inner.mkdirSync(path, { recursive: true });
		}

		// Restore files
		const files = entries.filter(([, e]) => e.type === "file");
		for (const [path, entry] of files) {
			const content = entry.content ? base64ToUint8(entry.content) : new Uint8Array(0);
			this.inner.writeFileSync(path, content, undefined, {
				mode: entry.mode,
				mtime: new Date(entry.mtime),
			});
		}

		// Restore symlinks
		const symlinks = entries.filter(([, e]) => e.type === "symlink");
		for (const [path, entry] of symlinks) {
			if (entry.target) {
				await this.inner.symlink(entry.target, path);
			}
		}
	}

	private async save(): Promise<void> {
		const entries: Record<string, SerializedEntry> = {};
		const paths = this.inner.getAllPaths();

		for (const path of paths) {
			if (!shouldPersist(path)) continue;

			try {
				const st = await this.inner.lstat(path);
				const type: "file" | "directory" | "symlink" = st.isSymbolicLink
					? "symlink"
					: st.isFile
						? "file"
						: "directory";

				const entry: SerializedEntry = {
					type,
					mode: st.mode,
					mtime: st.mtime.getTime(),
				};

				if (type === "file") {
					const buf = await this.inner.readFileBuffer(path);
					entry.content = uint8ToBase64(buf);
				} else if (type === "symlink") {
					entry.target = await this.inner.readlink(path);
				}

				entries[path] = entry;
			} catch {
				// skip entries we can't read
			}
		}

		const state: SerializedState = { version: STATE_VERSION, entries };
		const json = JSON.stringify(state);

		const file = await this.opfsDir.getFileHandle(OPFS_FILE, { create: true });
		const writable = await file.createWritable();
		await writable.write(json);
		await writable.close();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
		}
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.save().catch((err) => console.warn("[OpfsBackedFs] save failed:", err));
		}, SAVE_DEBOUNCE_MS);
	}

	/** Best-effort synchronous flush (fire-and-forget). */
	private flushSync(): void {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		this.save().catch((err) => console.warn("[OpfsBackedFs] flush failed:", err));
	}

	/** Delete all persisted state. */
	async clear(): Promise<void> {
		try {
			await this.opfsDir.removeEntry(OPFS_FILE);
		} catch {
			/* ignore */
		}
	}

	// ---- sync pass-throughs for initFilesystem / registerCommand ----

	mkdirSync(path: string, options?: { recursive?: boolean }): void {
		this.inner.mkdirSync(path, options);
	}

	writeFileSync(path: string, content: string | Uint8Array): void {
		this.inner.writeFileSync(path, content);
	}

	// ---- IFileSystem delegation ----

	readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
		return this.inner.readFile(path, options);
	}

	readFileBuffer(path: string): Promise<Uint8Array> {
		return this.inner.readFileBuffer(path);
	}

	async writeFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
		await this.inner.writeFile(path, content, options);
		this.scheduleSave();
	}

	async appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
		await this.inner.appendFile(path, content, options);
		this.scheduleSave();
	}

	exists(path: string): Promise<boolean> {
		return this.inner.exists(path);
	}

	stat(path: string): Promise<FsStat> {
		return this.inner.stat(path);
	}

	async mkdir(path: string, options?: MkdirOptions): Promise<void> {
		await this.inner.mkdir(path, options);
		this.scheduleSave();
	}

	readdir(path: string): Promise<string[]> {
		return this.inner.readdir(path);
	}

	readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
		return this.inner.readdirWithFileTypes(path);
	}

	async rm(path: string, options?: RmOptions): Promise<void> {
		await this.inner.rm(path, options);
		this.scheduleSave();
	}

	async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
		await this.inner.cp(src, dest, options);
		this.scheduleSave();
	}

	async mv(src: string, dest: string): Promise<void> {
		await this.inner.mv(src, dest);
		this.scheduleSave();
	}

	resolvePath(base: string, path: string): string {
		return this.inner.resolvePath(base, path);
	}

	getAllPaths(): string[] {
		return this.inner.getAllPaths();
	}

	async chmod(path: string, mode: number): Promise<void> {
		await this.inner.chmod(path, mode);
		this.scheduleSave();
	}

	async symlink(target: string, linkPath: string): Promise<void> {
		await this.inner.symlink(target, linkPath);
		this.scheduleSave();
	}

	async link(existingPath: string, newPath: string): Promise<void> {
		await this.inner.link(existingPath, newPath);
		this.scheduleSave();
	}

	readlink(path: string): Promise<string> {
		return this.inner.readlink(path);
	}

	lstat(path: string): Promise<FsStat> {
		return this.inner.lstat(path);
	}

	realpath(path: string): Promise<string> {
		return this.inner.realpath(path);
	}

	async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
		await this.inner.utimes(path, atime, mtime);
		this.scheduleSave();
	}
}
