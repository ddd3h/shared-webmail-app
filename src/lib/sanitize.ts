import sanitizeHtml from 'sanitize-html';

// Strict allowlist for email HTML bodies stored in the database.
// Blocks script execution vectors: script/iframe/object/embed/form/meta/base/style tags,
// on* event attributes, and javascript:/data: URL schemes.
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'a', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
      'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
      'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub',
      'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr',
      'u', 'ul', 'var', 'wbr',
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel'],
      'img': ['src', 'alt', 'title', 'width', 'height', 'style'],
      'td': ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'style'],
      'th': ['colspan', 'rowspan', 'align', 'valign', 'style'],
      'tr': ['align', 'valign', 'style'],
      'table': ['border', 'cellpadding', 'cellspacing', 'width', 'style', 'align'],
      'col': ['span', 'width', 'style'],
      'colgroup': ['span', 'style'],
      'div': ['style', 'align'],
      'p': ['style', 'align'],
      'span': ['style'],
      'blockquote': ['cite', 'style'],
      'ol': ['start', 'type', 'style'],
      'ul': ['style'],
      'li': ['style'],
      'h1': ['style'], 'h2': ['style'], 'h3': ['style'],
      'h4': ['style'], 'h5': ['style'], 'h6': ['style'],
      'pre': ['style'],
      'code': ['style'],
      'hr': ['style'],
      'figure': ['style'],
      'time': ['datetime'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data', 'cid'],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          // Force external links to open safely
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
    // Strip disallowed tags entirely (don't keep their text content for dangerous tags)
    exclusiveFilter: frame =>
      ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
       'applet', 'form', 'input', 'button', 'select', 'textarea',
       'meta', 'base', 'link'].includes(frame.tag),
  });
}
