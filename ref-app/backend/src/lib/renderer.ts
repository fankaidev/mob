import { Context } from 'hono';
import Handlebars from 'handlebars/runtime';

// Custom interface for the render function
export interface RenderOptions {
  title?: string;
  layout?: string;
  [key: string]: unknown;
}

// Map to store compiled templates
const templateCache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Register default Handlebars helpers
 */
export function registerHelpers() {
  Handlebars.registerHelper('urlEncode', (str) => {
    return encodeURIComponent(str || '');
  });

  Handlebars.registerHelper('json', (context) => {
    // Escape special characters that could break out of HTML contexts
    const jsonStr = JSON.stringify(context)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    return new Handlebars.SafeString(jsonStr);
  });

  Handlebars.registerHelper('eq', (a, b) => {
    return a === b;
  });

  Handlebars.registerHelper('formatDate', (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString();
  });

  Handlebars.registerHelper('buildUrl', function(basePath: string, options: Handlebars.HelperOptions) {
    const params = options.hash;
    const queryParts: string[] = [];

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }

    if (queryParts.length === 0) {
      return basePath;
    }
    return `${basePath}?${queryParts.join('&')}`;
  });
}

/**
 * Register all templates as partials
 */
export function registerPartials(templates: Record<string, TemplateSpecification>) {
  Object.entries(templates).forEach(([name, spec]) => {
    // For precompiled templates, we need to use Handlebars.template()
    const templateDelegate = Handlebars.template(spec);
    Handlebars.registerPartial(name, templateDelegate);
  });
}

/**
 * Simple Handlebars renderer for Hono
 * Note: In a real Cloudflare Worker environment, we use precompiled templates
 * to avoid using 'new Function()' which is disallowed.
 */
export async function render(
  c: Context,
  templateName: string,
  data: RenderOptions = {},
  templates: Record<string, TemplateSpecification>
) {
  const layoutName = data.layout || 'main';
  const layoutKey = `layouts/${layoutName}`;

  if (!templates[templateName]) {
    return c.text(`Template not found: ${templateName}`, 404);
  }

  if (!templates[layoutKey]) {
    return c.text(`Layout not found: ${layoutName}`, 404);
  }

  // Use cached template or compile and cache
  let template = templateCache.get(templateName);
  if (!template) {
    template = Handlebars.template(templates[templateName]);
    templateCache.set(templateName, template);
  }

  let layout = templateCache.get(layoutKey);
  if (!layout) {
    layout = Handlebars.template(templates[layoutKey]);
    templateCache.set(layoutKey, layout);
  }

  const body = template(data);
  const html = layout({
    ...data,
    body
  });

  return c.html(html);
}

