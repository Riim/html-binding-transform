var htmlparser = require('htmlparser2');

var reEscapableChars = /([?+|$(){}[^.\-\]\/\\*])/g;

/**
 * @typesign (str: string): string;
 */
function escapeRegExp(str) {
	return str.replace(reEscapableChars, '\\$1');
}

var selfClosingTags = {
	__proto__: null,

	area: 1,
	base: 1,
	basefont: 1,
	br: 1,
	col: 1,
	command: 1,
	embed: 1,
	frame: 1,
	hr: 1,
	img: 1,
	input: 1,
	isindex: 1,
	keygen: 1,
	link: 1,
	meta: 1,
	param: 1,
	source: 1,
	track: 1,
	wbr: 1,

	// svg tags
	circle: 1,
	ellipse: 1,
	line: 1,
	path: 1,
	polygone: 1,
	polyline: 1,
	rect: 1,
	stop: 1,
	use: 1
};

/**
 * @typesign (html: string): Array;
 */
function htmlToDOM(html) {
	var handler = new htmlparser.DomHandler(function(err, dom) {}, {
		normalizeWhitespace: true
	});

	var parser = new htmlparser.Parser(handler, {
		xmlMode: false,
		recognizeSelfClosing: false,
		recognizeCDATA: false,
		decodeEntities: false,
		lowerCaseTags: false,
		lowerCaseAttributeNames: false
	});

	parser.parseComplete(html);

	return handler.dom;
}

/**
 * @typesign (dom: Array, xhtmlMode: boolean = false): string;
 */
function domToHTML(dom, xhtmlMode) {
	return dom.map(function(node) {
		switch (node.type) {
			case 'directive': {
				return '<' + node.data + '>';
			}
			case 'script':
			case 'style':
			case 'tag': {
				var attrs = node.attribs;
				var html = ['<' + node.name];

				for (var name in attrs) {
					html.push(' ' + name + '="' + attrs[name] + '"');
				}

				if (node.children.length) {
					html.push('>' + domToHTML(node.children, xhtmlMode) + '</' + node.name + '>');
				} else {
					if (node.name in selfClosingTags) {
						html.push(xhtmlMode ? ' />' : '>');
					} else {
						html.push('></' + node.name + '>');
					}
				}

				return html.join('');
			}
			case 'text': {
				return node.data;
			}
			case 'cdata': {
				return '<' + node.data + '>';
			}
			case 'comment': {
				return '<!--' + node.data + '-->';
			}
		}
	}).join('');
}

/**
 * @typesign (dom: Array, cb: Function);
 */
function processDOM(dom, cb) {
	dom.forEach(function(node, index, nodes) {
		cb(node, index, nodes);

		switch (node.type) {
			case 'script':
			case 'style':
			case 'tag': {
				processDOM(node.children, cb);
			}
		}
	});
}

/**
 * @typesign (data: Array<string>, templateDelimiters: Array<string>, root: string):
 *     { bindingExpr: string, newData: string };
 */
function parseData(data, templateDelimiters, root) {
	var bindingExpr = [];
	var newData = [];

	data.forEach(function(piece, index) {
		if (index % 2) {
			bindingExpr.push(root + '.' + piece);
			newData.push(templateDelimiters[0] + piece + templateDelimiters[1]);
		} else {
			if (piece) {
				bindingExpr.push(
					'\'' + piece
						.split('\\').join('\\\\')
						.split('\'').join('\\\'')
						.split('\r').join('\\r')
						.split('\n').join('\\n') + '\''
				);

				newData.push(piece);
			} else {
				if (index == 2) {
					bindingExpr.push("''");
				}
			}
		}
	});

	return {
		bindingExpr: bindingExpr.join('+').split('"').join('&quot;'),
		newData: newData.join('')
	};
}

var defaults = {
	attrBindName: 'data-bind',
	skipAttributes: [],
	templateDelimiters: ['{{', '}}'],
	bindingDelimiters: ['{', '}'],
	root: 'this',
	xhtmlMode: false
};

/**
 * @typesign (html: string, opts?: {
 *     attrBindName: string = 'data-bind',
 *     skipAttributes: Array<string> = [],
 *     templateDelimiters: Array<string> = ['{{', '}}'],
 *     bindingDelimiters: Array<string> = ['{', '}'],
 *     root: string = 'this',
 *     xhtmlMode: boolean = false
 * }): string;
 */
function htmlBindingTransform(html, opts) {
	if (!opts) {
		opts = {};
	}
	opts.__proto__ = defaults;

	var attrBindName = opts.attrBindName;
	var skipAttributes = opts.skipAttributes.indexOf(attrBindName) == -1 ?
		opts.skipAttributes.concat(attrBindName) :
		opts.skipAttributes;
	var templateDelimiters = opts.templateDelimiters;
	var root = opts.root;

	var reTemplateInsert = RegExp(
		escapeRegExp(opts.templateDelimiters[0]) + '[\\s\\S]*?' + escapeRegExp(opts.templateDelimiters[1]),
		'g'
	);
	var reBindingInsert = RegExp(
		escapeRegExp(opts.bindingDelimiters[0]) + '\\s*(\\S.*?)\\s*' + escapeRegExp(opts.bindingDelimiters[1])
	);

	var traceIdCounter = 0;
	var reTraces = [];
	var templateInserts = [];

	html = html.replace(reTemplateInsert, function(insert) {
		var trace;

		do {
			trace = 'bindify_' + (++traceIdCounter);
		} while (html.indexOf(trace) != -1);

		reTraces.push(trace);
		templateInserts.push({ trace: trace, insert: insert });

		return trace;
	});

	reTraces = RegExp(reTraces.join('|'));

	var dom = htmlToDOM(html);

	processDOM(dom, function(node, index, nodes) {
		if (node.type == 'text') {
			var data = node.data;

			if (reBindingInsert.test(data) && reTraces.test(data)) {
				data = data.replace(reBindingInsert, function(data) {
					return '<span>' + data + '</span>';
				});

				var dom = htmlToDOM(data);

				dom[0].prev = node.prev;
				dom[dom.length - 1].next = node.next;

				var parent = node.parent;

				if (parent) {
					for (var i = dom.length; i;) {
						dom[--i].parent = parent;
					}
				}

				nodes.splice.apply(nodes, [index, 1].concat(dom));
			}
		}
	});

	if (dom.length == 1 && dom[0].type == 'text' && reBindingInsert.test(html)) {
		dom = htmlToDOM('<span>' + html + '</span>');
	}

	processDOM(dom, function(node) {
		var attrs;
		var attrBindData;
		var data;

		if (node.type == 'tag') {
			attrs = node.attribs;

			for (var name in attrs) {
				if (skipAttributes.indexOf(name) != -1) {
					continue;
				}

				data = attrs[name].split(reBindingInsert);

				if (data.length > 1) {
					attrBindData = (attrs[attrBindName] || '').trim();
					data = parseData(data, templateDelimiters, root);

					attrs[attrBindName] = attrBindData + (attrBindData ? ',' : '') +
						(name == 'value' ? 'value:' : 'attr(' + name + '):') +
						data.bindingExpr;

					attrs[name] = data.newData;
				}
			}
		} else if (node.type == 'text') {
			data = node.data.split(reBindingInsert);

			if (data.length > 1) {
				attrs = (node.prev || node.parent || node.next).attribs;
				attrBindData = (attrs[attrBindName] || '').trim();
				data = parseData(data, templateDelimiters, root);

				if (attrBindData) {
					attrBindData += ',';
				}

				if (node.prev) {
					attrBindData += 'text(next):';
				} else if (node.parent) {
					attrBindData += node.next ? 'text(first):' : 'text:';
				} else {
					attrBindData += 'text(prev):';
				}

				attrs[attrBindName] = attrBindData + data.bindingExpr;

				node.data = data.newData;
			}
		}
	});

	html = domToHTML(dom, opts.xhtmlMode);

	for (var i = templateInserts.length; i;) {
		html = html.split(templateInserts[--i].trace).join(templateInserts[i].insert);
	}

	return html;
}

module.exports = htmlBindingTransform;
