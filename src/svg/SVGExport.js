/*
 * Paper.js - The Swiss Army Knife of Vector Graphics Scripting.
 * http://paperjs.org/
 *
 * Copyright (c) 2011 - 2013, Juerg Lehni & Jonathan Puckey
 * http://lehni.org/ & http://jonathanpuckey.com/
 *
 * Distributed under the MIT license. See LICENSE file for details.
 *
 * All rights reserved.
 */

/**
 * A function scope holding all the functionality needed to convert a
 * Paper.js DOM to a SVG DOM.
 */
new function() {
	// TODO: Consider moving formatter into options object, and pass it along.
	var formatter;

	function setAttributes(node, attrs) {
		for (var key in attrs) {
			var val = attrs[key],
				namespace = SVGNamespaces[key];
			if (typeof val === 'number')
				val = formatter.number(val);
			if (namespace) {
				node.setAttributeNS(namespace, key, val);
			} else {
				node.setAttribute(key, val);
			}
		}
		return node;
	}

	function createElement(tag, attrs) {
		return setAttributes(
			document.createElementNS('http://www.w3.org/2000/svg', tag), attrs);
	}

	function getTransform(item, coordinates, center) {
		var matrix = item._matrix,
			trans = matrix.getTranslation(),
			attrs = {};
		if (coordinates) {
			// If the item suppports x- and y- coordinates, we're taking out the
			// translation part of the matrix and move it to x, y attributes, to
			// produce more readable markup, and not have to use center points
			// in rotate(). To do so, SVG requries us to inverse transform the
			// translation point by the matrix itself, since they are provided
			// in local coordinates.
			matrix = matrix.shiftless();
			var point = matrix._inverseTransform(trans);
			attrs[center ? 'cx' : 'x'] = point.x;
			attrs[center ? 'cy' : 'y'] = point.y;
			trans = null;
		}
		if (matrix.isIdentity())
			return attrs;
		// See if we can decompose the matrix and can formulate it as a simple
		// translate/scale/rotate command sequence.
		var decomposed = matrix.decompose();
		if (decomposed && !decomposed.shearing) {
			var parts = [],
				angle = decomposed.rotation,
				scale = decomposed.scaling;
			if (trans && !trans.isZero())
				parts.push('translate(' + formatter.point(trans) + ')');
			if (angle)
				parts.push('rotate(' + formatter.number(angle) + ')');
			if (!Numerical.isZero(scale.x - 1) || !Numerical.isZero(scale.y - 1))
				parts.push('scale(' + formatter.point(scale) +')');
			attrs.transform = parts.join(' ');
		} else {
			attrs.transform = 'matrix(' + matrix.getValues().join(',') + ')';
		}
		return attrs;
	}

	function exportGroup(item, options) {
		var attrs = getTransform(item),
			children = item._children;
		var node = createElement('g', attrs);
		for (var i = 0, l = children.length; i < l; i++) {
			var child = children[i];
			var childNode = exportSVG(child, options);
			if (childNode) {
				if (child.isClipMask()) {
					var clip = createElement('clipPath');
					clip.appendChild(childNode);
					setDefinition(child, clip, 'clip');
					setAttributes(node, {
						'clip-path': 'url(#' + clip.id + ')'
					});
				} else {
					node.appendChild(childNode);
				}
			}
		}
		return node;
	}

	function exportRaster(item) {
		var attrs = getTransform(item, true),
			size = item.getSize();
		// Take into account that rasters are centered:
		attrs.x -= size.width / 2;
		attrs.y -= size.height / 2;
		attrs.width = size.width;
		attrs.height = size.height;
		attrs.href = item.toDataURL();
		return createElement('image', attrs);
	}

	function exportPath(item, options) {
        if (options.matchShapes) {
            var shape = item.toShape(false);
            if (shape)
                return exportShape(shape, options);
        }
        var segments = item._segments,
            type,
            attrs;
        if (segments.length === 0)
            return null;
        if (item.isPolygon()) {
            var svgBounds = paper.project.SVGBounds;
            if (segments.length >= 3) {
                type = item._closed ? 'polygon' : 'polyline';
                var parts = [];
                for(i = 0, l = segments.length; i < l; i++)  {
                    p = new Point(segments[i]._point.x-svgBounds.x+5,segments[i]._point.y-svgBounds.y+5);
                    parts.push(formatter.point(p));
                }
                attrs = {
                    points: parts.join(' ')
                };
            } else {
                type = 'line';
                var first = new Point(segments[0]._point.x-svgBounds.x+5,segments[0]._point.y-svgBounds.y+5),
                    last = new Point(segments[segments.length - 1]._point.x-svgBounds.x+5,segments[segments.length - 1]._point.y-svgBounds.y+5);
                attrs = {
                    x1: first.x,
                    y1: first.y,
                    x2: last.x,
                    y2: last.y
                };
            }
        } else {
            type = 'path';
            var data = item.getPathData();
            attrs = data && { d: data };
        }
        return createElement(type, attrs);
	}

	function exportShape(item) {
		var shape = item._shape,
			radius = item._radius,
			attrs = getTransform(item, true, shape !== 'rectangle');
		if (shape === 'rectangle') {
			shape = 'rect'; // SVG
			var size = item._size,
				width = size.width,
				height = size.height;
			attrs.x -= width / 2;
			attrs.y -= height / 2;
			attrs.width = width;
			attrs.height = height;
			if (radius.isZero())
				radius = null;
		}
		if (radius) {
			if (shape === 'circle') {
				attrs.r = radius;
			} else {
				attrs.rx = radius.width;
				attrs.ry = radius.height;
			}
		}
		return createElement(shape, attrs);
	}

	function exportCompoundPath(item) {
		var attrs = getTransform(item, true);
		var data = item.getPathData();
		if (data)
			attrs.d = data;
		return createElement('path', attrs);
	}

	function exportPlacedSymbol(item, options) {
		var attrs = getTransform(item, true),
			symbol = item.getSymbol(),
			symbolNode = getDefinition(symbol, 'symbol'),
			definition = symbol.getDefinition(),
			bounds = definition.getBounds();
		if (!symbolNode) {
			symbolNode = createElement('symbol', {
				viewBox: formatter.rectangle(bounds)
			});
			symbolNode.appendChild(exportSVG(definition, options));
			setDefinition(symbol, symbolNode, 'symbol');
		}
		attrs.href = '#' + symbolNode.id;
		attrs.x += bounds.x;
		attrs.y += bounds.y;
		attrs.width = formatter.number(bounds.width);
		attrs.height = formatter.number(bounds.height);
		return createElement('use', attrs);
	}

	function exportGradient(color) {
		// NOTE: As long as the fillTransform attribute is not implemented,
		// we need to create a separate gradient object for each gradient,
		// even when they share the same gradient defintion.
		// http://www.svgopen.org/2011/papers/20-Separating_gradients_from_geometry/
		// TODO: Implement gradient merging in SVGImport
		var gradientNode = getDefinition(color, 'color');
		if (!gradientNode) {
			var gradient = color.getGradient(),
				radial = gradient._radial,
				origin = color.getOrigin().transform(),
				destination = color.getDestination().transform(),
				attrs;
			if (radial) {
				attrs = {
					cx: origin.x,
					cy: origin.y,
					r: origin.getDistance(destination)
				};
				var highlight = color.getHighlight();
				if (highlight) {
					highlight = highlight.transform();
					attrs.fx = highlight.x;
					attrs.fy = highlight.y;
				}
			} else {
				attrs = {
					x1: origin.x,
					y1: origin.y,
					x2: destination.x,
					y2: destination.y
				};
			}
			attrs.gradientUnits = 'userSpaceOnUse';
			gradientNode = createElement(
					(radial ? 'radial' : 'linear') + 'Gradient', attrs);
			var stops = gradient._stops;
			for (var i = 0, l = stops.length; i < l; i++) {
				var stop = stops[i],
					stopColor = stop._color,
					alpha = stopColor.getAlpha();
				attrs = {
					offset: stop._rampPoint,
					'stop-color': stopColor.toCSS(true)
				};
				// See applyStyle for an explanation of why there are separated
				// opacity / color attributes.
				if (alpha < 1)
					attrs['stop-opacity'] = alpha;
				gradientNode.appendChild(createElement('stop', attrs));
			}
			setDefinition(color, gradientNode, 'color');
		}
		return 'url(#' + gradientNode.id + ')';
	}

	function exportText(item) {
        var svgBounds = paper.project.SVGBounds, coords = getTransform(item, true);
        coords.x = coords.x-svgBounds.x+5;
        coords.y = coords.y-svgBounds.y+6;
        var node = createElement('text', coords);
        node.textContent = item._content;
        return node;
	}

	var exporters = {
		group: exportGroup,
		layer: exportGroup,
		raster: exportRaster,
		path: exportPath,
		shape: exportShape,
		'compound-path': exportCompoundPath,
		'placed-symbol': exportPlacedSymbol,
		'point-text': exportText
	};

	function applyStyle(item, node) {
		var attrs = {},
			parent = item.getParent();

		if (item._name != null)
			attrs.id = item._name;

		Base.each(SVGStyles, function(entry) {
			// Get a given style only if it differs from the value on the parent
			// (A layer or group which can have style values in SVG).
			var get = entry.get,
				type = entry.type,
				value = item[get]();
			if (!parent || !Base.equals(parent[get](), value)) {
				if (type === 'color' && value != null) {
					// Support for css-style rgba() values is not in SVG 1.1, so
					// separate the alpha value of colors with alpha into the
					// separate fill- / stroke-opacity attribute:
					var alpha = value.getAlpha();
					if (alpha < 1)
						attrs[entry.attribute + '-opacity'] = alpha;
				}
				attrs[entry.attribute] = value == null
					? 'none'
					: type === 'number'
						? formatter.number(value)
						: type === 'color'
							? value.gradient
								? exportGradient(value, item)
								// true for noAlpha, see above	
								: value.toCSS(true)
							: type === 'array'
								? value.join(',')
								: type === 'lookup'
									? entry.toSVG[value]
									: value;
			}
		});

		if (attrs.opacity === 1)
			delete attrs.opacity;

		if (item._visibility != null && !item._visibility)
			attrs.visibility = 'hidden';

		return setAttributes(node, attrs);
	}

	var definitions;
	function getDefinition(item, type) {
		if (!definitions)
			definitions = { ids: {}, svgs: {} };
		return item && definitions.svgs[type + '-' + item._id];
	}

	function setDefinition(item, node, type) {
		// Make sure the definitions lookup is created before we use it.
		// This is required by 'clip', where getDefinition() is not called.
		if (!definitions)
			getDefinition();
		// Have different id ranges per type
		var id = definitions.ids[type] = (definitions.ids[type] || 0) + 1;
		// Give the svg node an id, and link to it from the item id.
		node.id = type + '-' + id;
		definitions.svgs[type + '-' + item._id] = node;
	}

	function exportDefinitions(node, options) {
		var svg = node,
			defs = null;
		if (definitions) {
			// We can only use svg nodes as defintion containers. Have the loop
			// produce one if it's a single item of another type (when calling
			// #exportSVG() on an item rather than a whole project)
			// jsdom in Node.js uses uppercase values for nodeName...
			svg = node.nodeName.toLowerCase() === 'svg' && node;
			for (var i in definitions.svgs) {
				// This code is inside the loop so we only create a container if
				// we actually have svgs.
				if (!defs) {
					if (!svg) {
						svg = createElement('svg');
						svg.appendChild(node);
					}
					defs = svg.insertBefore(createElement('defs'),
							svg.firstChild);
				}
				defs.appendChild(definitions.svgs[i]);
			}
			// Clear definitions at the end of export
			definitions = null;
		}
		return options.asString
				? new XMLSerializer().serializeToString(svg)
				: svg;
	}

	function exportSVG(item, options) {
        var exporter = exporters[item._type],
            node = exporter && exporter(item, options);
        if (node && item._data)
            node.setAttribute('data-paper-data', JSON.stringify(item._data));
        if (item.dType && item.dType === 'bond' && (!item.bondType || item.bondType !== "aux")) {
            if (!item._bData) item._bData = {};
            item._bData.bO = item.bondOrder || 1;
            switch (item.stereo) {
                case 0: {
                    item._bData.bS = 0;
                    break;
                }
                case undefined: {
                    item._bData.bS = 0;
                    break;
                }
                case 'wedged': {
                    item._bData.bS = 1;
                    break;
                }
                case 'hashed': {
                    item._bData.bS = 6;
                    break;
                }
                default: {
                    item._bData.bS = 0;
                }
            }
            var nodes = [item.n_a, item.n_b], labels = [], points = {};
            for (var i = 0, l = nodes.length; i < l; i++) {
                if (nodes[i].labels && nodes[i].labels.atom) {
                    labels.push(nodes[i].labels.atom.content);
                    points[labels[i]] = new Point({
                        x: nodes[i].labels.atom.point.x,
                        y: nodes[i].labels.atom.point.y - 3.5
                    })
                } else {
                    labels.push("C")
                }
            }
            item._bData.a1 = {
                id: item.n_a.ref.substring(5),
                x: points[labels[0]] ? points[labels[0]].x.toFixed(5) : item.n_a.point.x.toFixed(5),
                y: points[labels[0]] ? points[labels[0]].y.toFixed(5) : item.n_a.point.y.toFixed(5),
                l: labels[0]
            };
            item._bData.a2 = {
                id: item.n_b.ref.substring(5),
                x: points[labels[1]] ? points[labels[1]].x.toFixed(5) : item.n_b.point.x.toFixed(5),
                y: points[labels[1]] ? points[labels[1]].y.toFixed(5) : item.n_b.point.y.toFixed(5),
                l: labels[1]
            };
        } else if (item.dType && item.dType === 'label') {
            if (!item._bData) item._bData = {};
            item._bData.c = item.content;
            var point = new Point({
                x: item.point.x,
                y: item.point.y - 3.5
            })
            item._bData.p = {
                x: point.x,
                y: point.y
            };
        }
        if (node && item._bData)
            node.setAttribute('bData', JSON.stringify(item._bData));
		return node && applyStyle(item, node);
	}

	function setOptions(options) {
		if (!options)
			options = {};
		formatter = new Formatter(options.precision);
		return options;
	}

	Item.inject({
		exportSVG: function(options) {
			options = setOptions(options);
			return exportDefinitions(exportSVG(this, options), options);
		}
	});

	Project.inject({
        getSvgBounds: function() {
            var bounds = void 0, i = 0, l = this.layers.length;
            while(i < l) {
                var layer = this.layers[i], j = 0, k = layer.children.length;
                while(j < k) {
                    var child = layer.children[j]
                    if (child.type === "group" && child.children.length !== 0) {
                        if (!bounds) {
                            bounds = child.bounds;
                        } else {
                            var rect = child.bounds;
                            var x1 = Math.min(bounds._x || bounds.x, rect._x),
                                y1 = Math.min(bounds._y || bounds.y, rect._y),
                                x2 = Math.max((bounds._x || bounds.x) + bounds.width, (rect._x || rect.x) + rect.width),
                                y2 = Math.max((bounds._y || bounds.y) + bounds.height, (rect._y || rect.y) + rect.height);
                            bounds = new Rectangle(x1, y1, x2 - x1, y2 - y1);
                        }
                    }
                    j++;
                }
                i++;
            }
            return bounds;
        },
        exportSVG: function(options) {
            options = setOptions(options);
            this.SVGBounds = this.getSvgBounds();
            this.SVGBoundsSize = new Size(this.SVGBounds.size.width+10, this.SVGBounds.size.height+10);
            var layers = this.layers,
                size = this.SVGBoundsSize || this.view.getSize(),
                node = createElement('svg', {
                    x: 0,
                    y: 0,
                    width: size.width,
                    height: size.height,
                    version: '1.1',
                    xmlns: 'http://www.w3.org/2000/svg',
                    'xmlns:xlink': 'http://www.w3.org/1999/xlink'
                });
            for (var i = 0, l = layers.length; i < l; i++)
                node.appendChild(exportSVG(layers[i], options));
            return exportDefinitions(node, options);
        }
	});
};
