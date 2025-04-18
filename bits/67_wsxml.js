function parse_ws_xml_dim(ws/*:Worksheet*/, s/*:string*/) {
	var d = safe_decode_range(s);
	if(d.s.r<=d.e.r && d.s.c<=d.e.c && d.s.r>=0 && d.s.c>=0) ws["!ref"] = encode_range(d);
}
var mergecregex = /<(?:\w+:)?mergeCell ref=["'][A-Z0-9:]+['"]\s*[\/]?>/g;
var hlinkregex = /<(?:\w+:)?hyperlink [^<>]*>/mg;
var dimregex = /"(\w*:\w*)"/;
var colregex = /<(?:\w+:)?col\b[^<>]*[\/]?>/g;
var afregex = /<(?:\w:)?autoFilter[^>]*([\/]|>([\s\S]*)<\/(?:\w:)?autoFilter)>/g;
var marginregex= /<(?:\w+:)?pageMargins[^<>]*\/>/g;
var sheetprregex = /<(?:\w+:)?sheetPr\b[^<>]*?\/>/;

/* 18.3 Worksheets */
function parse_ws_xml(data/*:?string*/, opts, idx/*:number*/, rels, wb/*:WBWBProps*/, themes, styles)/*:Worksheet*/ {
	if(!data) return data;
	if(!rels) rels = {'!id':{}};
	if(DENSE != null && opts.dense == null) opts.dense = DENSE;

	/* 18.3.1.99 worksheet CT_Worksheet */
	var s = ({}/*:any*/); if(opts.dense) s["!data"] = [];
	var refguess/*:Range*/ = ({s: {r:2000000, c:2000000}, e: {r:0, c:0} }/*:any*/);

	var data1 = "", data2 = "";
	var mtch/*:?any*/ = str_match_xml_ns(data, "sheetData");
	if(mtch) {
		data1 = data.slice(0, mtch.index);
		data2 = data.slice(mtch.index + mtch[0].length);
	} else data1 = data2 = data;

	/* 18.3.1.82 sheetPr CT_SheetPr */
	var sheetPr = data1.match(sheetprregex);
	if(sheetPr) parse_ws_xml_sheetpr(sheetPr[0], s, wb, idx);
	else if((sheetPr = str_match_xml_ns(data1, "sheetPr"))) parse_ws_xml_sheetpr2(sheetPr[0], sheetPr[1]||"", s, wb, idx, styles, themes);

	/* 18.3.1.35 dimension CT_SheetDimension */
	var ridx = (data1.match(/<(?:\w*:)?dimension/)||{index:-1}).index;
	if(ridx > 0) {
		var ref = data1.slice(ridx,ridx+50).match(dimregex);
		if(ref && !(opts && opts.nodim)) parse_ws_xml_dim(s, ref[1]);
	}

	/* 18.3.1.88 sheetViews CT_SheetViews */
	var svs = str_match_xml_ns(data1, "sheetViews");
	if(svs && svs[1]) parse_ws_xml_sheetviews(svs[1], wb);

	/* 18.3.1.17 cols CT_Cols */
	var columns/*:Array<ColInfo>*/ = [];
	if(opts.cellStyles) {
		/* 18.3.1.13 col CT_Col */
		var cols = data1.match(colregex);
		if(cols) parse_ws_xml_cols(columns, cols);
	}

	/* 18.3.1.80 sheetData CT_SheetData ? */
	if(mtch) parse_ws_xml_data(mtch[1], s, opts, refguess, themes, styles, wb);

	/* 18.3.1.2  autoFilter CT_AutoFilter */
	var afilter = data2.match(afregex);
	if(afilter) s['!autofilter'] = parse_ws_xml_autofilter(afilter[0]);

	/* 18.3.1.55 mergeCells CT_MergeCells */
	var merges/*:Array<Range>*/ = [];
	var _merge = data2.match(mergecregex);
	if(_merge) for(ridx = 0; ridx != _merge.length; ++ridx)
		merges[ridx] = safe_decode_range(_merge[ridx].slice(_merge[ridx].indexOf("=")+2));

	/* 18.3.1.48 hyperlinks CT_Hyperlinks */
	var hlink = data2.match(hlinkregex);
	if(hlink) parse_ws_xml_hlinks(s, hlink, rels);

	/* 18.3.1.62 pageMargins CT_PageMargins */
	var margins = data2.match(marginregex);
	if(margins) s['!margins'] = parse_ws_xml_margins(parsexmltag(margins[0]));

	/* legacyDrawing */
	var m;
	if((m = data2.match(/legacyDrawing r:id="(.*?)"/))) s['!legrel'] = m[1];

	if(opts && opts.nodim) refguess.s.c = refguess.s.r = 0;
	if(!s["!ref"] && refguess.e.c >= refguess.s.c && refguess.e.r >= refguess.s.r) s["!ref"] = encode_range(refguess);
	if(opts.sheetRows > 0 && s["!ref"]) {
		var tmpref = safe_decode_range(s["!ref"]);
		if(opts.sheetRows <= +tmpref.e.r) {
			tmpref.e.r = opts.sheetRows - 1;
			if(tmpref.e.r > refguess.e.r) tmpref.e.r = refguess.e.r;
			if(tmpref.e.r < tmpref.s.r) tmpref.s.r = tmpref.e.r;
			if(tmpref.e.c > refguess.e.c) tmpref.e.c = refguess.e.c;
			if(tmpref.e.c < tmpref.s.c) tmpref.s.c = tmpref.e.c;
			s["!fullref"] = s["!ref"];
			s["!ref"] = encode_range(tmpref);
		}
	}
	if(columns.length > 0) s["!cols"] = columns;
	if(merges.length > 0) s["!merges"] = merges;
	if(rels['!id'][s['!legrel']]) s['!legdrawel'] = rels['!id'][s['!legrel']];
	return s;
}

function write_ws_xml_merges(merges/*:Array<Range>*/)/*:string*/ {
	if(merges.length === 0) return "";
	var o = '<mergeCells count="' + merges.length + '">';
	for(var i = 0; i != merges.length; ++i) o += '<mergeCell ref="' + encode_range(merges[i]) + '"/>';
	return o + '</mergeCells>';
}

/* 18.3.1.82-3 sheetPr CT_ChartsheetPr / CT_SheetPr */
function parse_ws_xml_sheetpr(sheetPr/*:string*/, s, wb/*:WBWBProps*/, idx/*:number*/) {
	var data = parsexmltag(sheetPr);
	if(!wb.Sheets[idx]) wb.Sheets[idx] = {};
	if(data.codeName) wb.Sheets[idx].CodeName = unescapexml(utf8read(data.codeName));
}
function parse_ws_xml_sheetpr2(sheetPr/*:string*/, body/*:string*/, s, wb/*:WBWBProps*/, idx/*:number*/) {
	parse_ws_xml_sheetpr(sheetPr.slice(0, sheetPr.indexOf(">")), s, wb, idx);
}
function write_ws_xml_sheetpr(ws, wb, idx, opts, o) {
	var needed = false;
	var props = {}, payload = null;
	if(opts.bookType !== 'xlsx' && wb.vbaraw) {
		var cname = wb.SheetNames[idx];
		try { if(wb.Workbook) cname = wb.Workbook.Sheets[idx].CodeName || cname; } catch(e) {}
		needed = true;
		props.codeName = utf8write(escapexml(cname));
	}

	if(ws && ws["!outline"]) {
		var outlineprops = {summaryBelow:1, summaryRight:1};
		if(ws["!outline"].above) outlineprops.summaryBelow = 0;
		if(ws["!outline"].left) outlineprops.summaryRight = 0;
		payload = (payload||"") + writextag('outlinePr', null, outlineprops);
	}

	if(!needed && !payload) return;
	o[o.length] = (writextag('sheetPr', payload, props));
}

/* 18.3.1.85 sheetProtection CT_SheetProtection */
var sheetprot_deffalse = ["objects", "scenarios", "selectLockedCells", "selectUnlockedCells"];
var sheetprot_deftrue = [
	"formatColumns", "formatRows", "formatCells",
	"insertColumns", "insertRows", "insertHyperlinks",
	"deleteColumns", "deleteRows",
	"sort", "autoFilter", "pivotTables"
];
function write_ws_xml_protection(sp)/*:string*/ {
	// algorithmName, hashValue, saltValue, spinCount
	var o = ({sheet:1}/*:any*/);
	sheetprot_deffalse.forEach(function(n) { if(sp[n] != null && sp[n]) o[n] = "1"; });
	sheetprot_deftrue.forEach(function(n) { if(sp[n] != null && !sp[n]) o[n] = "0"; });
	/* TODO: algorithm */
	if(sp.password) o.password = crypto_CreatePasswordVerifier_Method1(sp.password).toString(16).toUpperCase();
	return writextag('sheetProtection', null, o);
}

function parse_ws_xml_hlinks(s, data/*:Array<string>*/, rels) {
	var dense = s["!data"] != null;
	for(var i = 0; i != data.length; ++i) {
		var val = parsexmltag(utf8read(data[i]), true);
		if(!val.ref) return;
		var rel = ((rels || {})['!id']||[])[val.id];
		if(rel) {
			val.Target = rel.Target;
			if(val.location) val.Target += "#"+unescapexml(val.location);
		} else {
			val.Target = "#" + unescapexml(val.location);
			rel = {Target: val.Target, TargetMode: 'Internal'};
		}
		val.Rel = rel;
		if(val.tooltip) { val.Tooltip = val.tooltip; delete val.tooltip; }
		var rng = safe_decode_range(val.ref);
		for(var R=rng.s.r;R<=rng.e.r;++R) for(var C=rng.s.c;C<=rng.e.c;++C) {
			var addr = encode_col(C) + encode_row(R);
			if(dense) {
				if(!s["!data"][R]) s["!data"][R] = [];
				if(!s["!data"][R][C]) s["!data"][R][C] = {t:"z",v:undefined};
				s["!data"][R][C].l = val;
			} else {
				if(!s[addr]) s[addr] = {t:"z",v:undefined};
				s[addr].l = val;
			}
		}
	}
}

function parse_ws_xml_margins(margin) {
	var o = {};
	["left", "right", "top", "bottom", "header", "footer"].forEach(function(k) {
		if(margin[k]) o[k] = parseFloat(margin[k]);
	});
	return o;
}
function write_ws_xml_margins(margin)/*:string*/ {
	default_margins(margin);
	return writextag('pageMargins', null, margin);
}

function parse_ws_xml_cols(columns, cols) {
	var seencol = false;
	for(var coli = 0; coli != cols.length; ++coli) {
		var coll = parsexmltag(cols[coli], true);
		if(coll.hidden) coll.hidden = parsexmlbool(coll.hidden);
		var colm=parseInt(coll.min, 10)-1, colM=parseInt(coll.max,10)-1;
		if(coll.outlineLevel) coll.level = (+coll.outlineLevel || 0);
		delete coll.min; delete coll.max; coll.width = +coll.width;
		if(!seencol && coll.width) { seencol = true; find_mdw_colw(coll.width); }
		process_col(coll);
		while(colm <= colM) columns[colm++] = dup(coll);
	}
}
function write_ws_xml_cols(ws, cols)/*:string*/ {
	var o = ["<cols>"], col;
	for(var i = 0; i != cols.length; ++i) {
		if(!(col = cols[i])) continue;
		o[o.length] = (writextag('col', null, col_obj_w(i, col)));
	}
	o[o.length] = "</cols>";
	return o.join("");
}

function parse_ws_xml_autofilter(data/*:string*/) {
	var o = { ref: (data.match(/ref=["']([^"']*)["']/)||[])[1]};
	return o;
}
function write_ws_xml_autofilter(data, ws, wb, idx)/*:string*/ {
	var ref = typeof data.ref == "string" ? data.ref : encode_range(data.ref);
	if(!wb.Workbook) wb.Workbook = ({Sheets:[]}/*:any*/);
	if(!wb.Workbook.Names) wb.Workbook.Names = [];
	var names/*: Array<any> */ = wb.Workbook.Names;
	var range = decode_range(ref);
	if(range.s.r == range.e.r) { range.e.r = decode_range(ws["!ref"]).e.r; ref = encode_range(range); }
	for(var i = 0; i < names.length; ++i) {
		var name = names[i];
		if(name.Name != '_xlnm._FilterDatabase') continue;
		if(name.Sheet != idx) continue;
		name.Ref = formula_quote_sheet_name(wb.SheetNames[idx]) + "!" + fix_range(ref); break;
	}
	if(i == names.length) names.push({ Name: '_xlnm._FilterDatabase', Sheet: idx, Ref: "'" + wb.SheetNames[idx] + "'!" + ref  });
	return writextag("autoFilter", null, {ref:ref});
}

/* 18.3.1.88 sheetViews CT_SheetViews */
/* 18.3.1.87 sheetView CT_SheetView */
var sviewregex = /<(?:\w:)?sheetView(?:[^<>a-z][^<>]*)?\/?>/g;
function parse_ws_xml_sheetviews(data, wb/*:WBWBProps*/) {
	if(!wb.Views) wb.Views = [{}];
	(data.match(sviewregex)||[]).forEach(function(r/*:string*/, i/*:number*/) {
		var tag = parsexmltag(r);
		// $FlowIgnore
		if(!wb.Views[i]) wb.Views[i] = {};
		// $FlowIgnore
		if(+tag.zoomScale) wb.Views[i].zoom = +tag.zoomScale;
		// $FlowIgnore
		if(tag.rightToLeft && parsexmlbool(tag.rightToLeft)) wb.Views[i].RTL = true;
	});
}
function write_ws_xml_sheetviews(ws, opts, idx, wb)/*:string*/ {
	var sview = ({workbookViewId:"0"}/*:any*/);
	// $FlowIgnore
	if((((wb||{}).Workbook||{}).Views||[])[0]) sview.rightToLeft = wb.Workbook.Views[0].RTL ? "1" : "0";
	return writextag("sheetViews", writextag("sheetView", null, sview), {});
}

function write_ws_xml_cell(cell/*:Cell*/, ref, ws, opts, idx, wb, date1904)/*:string*/ {
	if(cell.c) ws['!comments'].push([ref, cell.c]);
	if((cell.v === undefined || cell.t === "z" && !(opts||{}).sheetStubs) && typeof cell.f !== "string" && typeof cell.z == "undefined") return "";
	var vv = "";
	var oldt = cell.t, oldv = cell.v;
	if(cell.t !== "z") switch(cell.t) {
		case 'b': vv = cell.v ? "1" : "0"; break;
		case 'n':
			if(isNaN(cell.v)) { cell.t = "e"; vv = BErr[cell.v = 0x24]; } // #NUM!
			else if(!isFinite(cell.v)) { cell.t = "e"; vv = BErr[cell.v = 0x07]; } // #DIV/0!
			else vv = ''+cell.v; break;
		case 'e': vv = BErr[cell.v]; break;
		case 'd':
			if(opts && opts.cellDates) {
				var _vv = parseDate(cell.v, date1904);
				vv = _vv.toISOString();
				if(_vv.getUTCFullYear() < 1900) vv = vv.slice(vv.indexOf("T") + 1).replace("Z","");
			} else {
				cell = dup(cell);
				cell.t = 'n';
				vv = ''+(cell.v = datenum(parseDate(cell.v, date1904), date1904));
			}
			if(typeof cell.z === 'undefined') cell.z = table_fmt[14];
			break;
		default: vv = cell.v; break;
	}
	var v = (cell.t == "z" || cell.v == null)? "" : writetag('v', escapexml(vv)), o = ({r:ref}/*:any*/);
	/* TODO: cell style */
	var os = get_cell_style(opts.cellXfs, cell, opts);
	if(os !== 0) o.s = os;
	switch(cell.t) {
		case 'n': break;
		case 'd': o.t = "d"; break;
		case 'b': o.t = "b"; break;
		case 'e': o.t = "e"; break;
		case 'z': break;
		default: if(cell.v == null) { delete cell.t; break; }
			if(cell.v.length > 32767) throw new Error("Text length must not exceed 32767 characters");
			if(opts && opts.bookSST) {
				v = writetag('v', ''+get_sst_id(opts.Strings, cell.v, opts.revStrings));
				o.t = "s"; break;
			}
			else o.t = "str"; break;
	}
	if(cell.t != oldt) { cell.t = oldt; cell.v = oldv; }
	if(typeof cell.f == "string" && cell.f) {
		var ff = cell.F && cell.F.slice(0, ref.length) == ref ? {t:"array", ref:cell.F} : null;
		v = writextag('f', escapexml(cell.f), ff) + (cell.v != null ? v : "");
	}
	if(cell.l) {
		cell.l.display = escapexml(vv);
		ws['!links'].push([ref, cell.l]);
	}
	if(cell.D) o.cm = 1;
	return writextag('c', v, o);
}

var parse_ws_xml_data = /*#__PURE__*/(function() {
	var cellregex = /<(?:\w+:)?c[ \/>]/, rowregex = /<\/(?:\w+:)?row>/;
	var rregex = /r=["']([^"']*)["']/;
	var refregex = /ref=["']([^"']*)["']/;

return function parse_ws_xml_data(sdata/*:string*/, s, opts, guess/*:Range*/, themes, styles, wb) {
	var ri = 0, x = "", cells/*:Array<string>*/ = [], cref/*:?Array<string>*/ = [], idx=0, i=0, cc=0, d="", p/*:any*/;
	var tag, tagr = 0, tagc = 0;
	var sstr, ftag;
	var fmtid = 0, fillid = 0;
	var do_format = Array.isArray(styles.CellXf), cf;
	var arrayf/*:Array<[Range, string]>*/ = [];
	var sharedf = [];
	var dense = s["!data"] != null;
	var rows/*:Array<RowInfo>*/ = [], rowobj = {}, rowrite = false;
	var sheetStubs = !!opts.sheetStubs;
	var date1904 = !!((wb||{}).WBProps||{}).date1904;
	for(var marr = sdata.split(rowregex), mt = 0, marrlen = marr.length; mt != marrlen; ++mt) {
		x = marr[mt].trim();
		var xlen = x.length;
		if(xlen === 0) continue;

		/* 18.3.1.73 row CT_Row */
		var rstarti = 0;
		outa: for(ri = 0; ri < xlen; ++ri) switch(/*x.charCodeAt(ri)*/x[ri]) {
			case ">" /*62*/:
				if(/*x.charCodeAt(ri-1) != 47*/x[ri-1] != "/") { ++ri; break outa; }
				if(opts && opts.cellStyles) {
					// TODO: avoid duplication
					tag = parsexmltag(x.slice(rstarti,ri), true);
					tagr = tag.r != null ? parseInt(tag.r, 10) : tagr+1; tagc = -1;
					if(opts.sheetRows && opts.sheetRows < tagr) continue;
					rowobj = {}; rowrite = false;
					if(tag.ht) { rowrite = true; rowobj.hpt = parseFloat(tag.ht); rowobj.hpx = pt2px(rowobj.hpt); }
					if(tag.hidden && parsexmlbool(tag.hidden)) { rowrite = true; rowobj.hidden = true; }
					if(tag.outlineLevel != null) { rowrite = true; rowobj.level = +tag.outlineLevel; }
					if(rowrite) rows[tagr-1] = rowobj;
				}
				break;
			case "<" /*60*/: rstarti = ri; break;
		}
		if(rstarti >= ri) break;
		tag = parsexmltag(x.slice(rstarti,ri), true);
		tagr = tag.r != null ? parseInt(tag.r, 10) : tagr+1; tagc = -1;
		if(opts.sheetRows && opts.sheetRows < tagr) continue;
		if(!opts.nodim) {
			if(guess.s.r > tagr - 1) guess.s.r = tagr - 1;
			if(guess.e.r < tagr - 1) guess.e.r = tagr - 1;
		}

		if(opts && opts.cellStyles) {
			rowobj = {}; rowrite = false;
			if(tag.ht) { rowrite = true; rowobj.hpt = parseFloat(tag.ht); rowobj.hpx = pt2px(rowobj.hpt); }
			if(tag.hidden && parsexmlbool(tag.hidden)) { rowrite = true; rowobj.hidden = true; }
			if(tag.outlineLevel != null) { rowrite = true; rowobj.level = +tag.outlineLevel; }
			if(rowrite) rows[tagr-1] = rowobj;
		}

		/* 18.3.1.4 c CT_Cell */
		cells = x.slice(ri).split(cellregex);
		for(var rslice = 0; rslice != cells.length; ++rslice) if(cells[rslice].trim().charAt(0) != "<") break;
		cells = cells.slice(rslice);
		for(ri = 0; ri != cells.length; ++ri) {
			x = cells[ri].trim();
			if(x.length === 0) continue;
			cref = x.match(rregex); idx = ri; i=0; cc=0;
			x = "<c " + (x.slice(0,1)=="<"?">":"") + x;
			if(cref != null && cref.length === 2) {
				idx = 0; d=cref[1];
				for(i=0; i != d.length; ++i) {
					if((cc=d.charCodeAt(i)-64) < 1 || cc > 26) break;
					idx = 26*idx + cc;
				}
				--idx;
				tagc = idx;
			} else ++tagc;
			for(i = 0; i != x.length; ++i) if(x.charCodeAt(i) === 62) break; ++i;
			tag = parsexmltag(x.slice(0,i), true);
			if(!tag.r) tag.r = encode_cell({r:tagr-1, c:tagc});
			d = x.slice(i);
			p = ({t:""}/*:any*/);

			if((cref=str_match_xml_ns(d, "v"))!= null && /*::cref != null && */cref[1] !== '') p.v=unescapexml(cref[1]);
			if(opts.cellFormula) {
				if((cref=str_match_xml_ns(d, "f"))!= null /*:: && cref != null*/) {
					if(cref[1] == "") {
						if(/*::cref != null && cref[0] != null && */cref[0].indexOf('t="shared"') > -1) {
							// TODO: parse formula
							ftag = parsexmltag(cref[0]);
							if(sharedf[ftag.si]) p.f = shift_formula_xlsx(sharedf[ftag.si][1], sharedf[ftag.si][2]/*[0].ref*/, tag.r);
						}
					} else {
						/* TODO: match against XLSXFutureFunctions */
						p.f=unescapexml(utf8read(cref[1]), true);
						if(!opts.xlfn) p.f = _xlfn(p.f);
						if(/*::cref != null && cref[0] != null && */cref[0].indexOf('t="array"') > -1) {
							p.F = (d.match(refregex)||[])[1];
							if(p.F.indexOf(":") > -1) arrayf.push([safe_decode_range(p.F), p.F]);
						} else if(/*::cref != null && cref[0] != null && */cref[0].indexOf('t="shared"') > -1) {
							// TODO: parse formula
							ftag = parsexmltag(cref[0]);
							var ___f = unescapexml(utf8read(cref[1]));
							if(!opts.xlfn) ___f = _xlfn(___f);
							sharedf[parseInt(ftag.si, 10)] = [ftag, ___f, tag.r];
						}
					}
				} else if((cref=d.match(/<f[^<>]*\/>/))) {
					ftag = parsexmltag(cref[0]);
					if(sharedf[ftag.si]) p.f = shift_formula_xlsx(sharedf[ftag.si][1], sharedf[ftag.si][2]/*[0].ref*/, tag.r);
				}
				/* TODO: factor out contains logic */
				var _tag = decode_cell(tag.r);
				for(i = 0; i < arrayf.length; ++i)
					if(_tag.r >= arrayf[i][0].s.r && _tag.r <= arrayf[i][0].e.r)
						if(_tag.c >= arrayf[i][0].s.c && _tag.c <= arrayf[i][0].e.c)
							p.F = arrayf[i][1];
			}

			if(tag.t == null && p.v === undefined) {
				if(p.f || p.F) {
					p.v = 0; p.t = "n";
				} else if(!sheetStubs) continue;
				else p.t = "z";
			}
			else p.t = tag.t || "n";
			if(guess.s.c > tagc) guess.s.c = tagc;
			if(guess.e.c < tagc) guess.e.c = tagc;
			/* 18.18.11 t ST_CellType */
			switch(p.t) {
				case 'n':
					if(p.v == "" || p.v == null) {
						if(!sheetStubs) continue;
						p.t = 'z';
					} else p.v = parseFloat(p.v);
					break;
				case 's':
					if(typeof p.v == 'undefined') {
						if(!sheetStubs) continue;
						p.t = 'z';
					} else {
						sstr = strs[parseInt(p.v, 10)];
						p.v = sstr.t;
						p.r = sstr.r;
						if(opts.cellHTML) p.h = sstr.h;
					}
					break;
				case 'str':
					p.t = "s";
					p.v = (p.v!=null) ? unescapexml(utf8read(p.v), true) : '';
					if(opts.cellHTML) p.h = escapehtml(p.v);
					break;
				case 'inlineStr':
					cref = str_match_xml_ns(d, "is");
					p.t = 's';
					if(cref != null && (sstr = parse_si(cref[1]))) {
						p.v = sstr.t;
						if(opts.cellHTML) p.h = sstr.h;
					} else p.v = "";
					break;
				case 'b': p.v = parsexmlbool(p.v); break;
				case 'd':
					if(opts.cellDates) p.v = parseDate(p.v, date1904);
					else { p.v = datenum(parseDate(p.v, date1904), date1904); p.t = 'n'; }
					break;
				/* error string in .w, number in .v */
				case 'e':
					if(!opts || opts.cellText !== false) p.w = p.v;
					p.v = RBErr[p.v]; break;
			}
			/* formatting */
			fmtid = fillid = 0;
			cf = null;
			if(do_format && tag.s !== undefined) {
				cf = styles.CellXf[tag.s];
				if(cf != null) {
					if(cf.numFmtId != null) fmtid = cf.numFmtId;
					if(opts.cellStyles) {
						if(cf.fillId != null) fillid = cf.fillId;
					}
				}
			}
			safe_format(p, fmtid, fillid, opts, themes, styles, date1904);
			if(opts.cellDates && do_format && p.t == 'n' && fmt_is_date(table_fmt[fmtid])) { p.v = numdate(p.v + (date1904 ? 1462 : 0)); p.t = typeof p.v == "number" ? 'n' : 'd'; }
			if(tag.cm && opts.xlmeta) {
				var cm = (opts.xlmeta.Cell||[])[+tag.cm-1];
				if(cm && cm.type == 'XLDAPR') p.D = true;
			}
			var _r;
			if(opts.nodim) {
				_r = decode_cell(tag.r);
				if(guess.s.r > _r.r) guess.s.r = _r.r;
				if(guess.e.r < _r.r) guess.e.r = _r.r;
			}
			if(dense) {
				_r = decode_cell(tag.r);
				if(!s["!data"][_r.r]) s["!data"][_r.r] = [];
				s["!data"][_r.r][_r.c] = p;
			} else s[tag.r] = p;
		}
	}
	if(rows.length > 0) s['!rows'] = rows;
}; })();

function write_ws_xml_data(ws/*:Worksheet*/, opts, idx/*:number*/, wb/*:Workbook*//*::, rels*/)/*:string*/ {
	var o/*:Array<string>*/ = [], r/*:Array<string>*/ = [], range = safe_decode_range(ws['!ref']), cell="", ref, rr = "", cols/*:Array<string>*/ = [], R=0, C=0, rows = ws['!rows'];
	var dense = ws["!data"] != null, data = dense ? ws["!data"] : [];
	var params = ({r:rr}/*:any*/), row/*:RowInfo*/, height = -1;
	var date1904 = (((wb||{}).Workbook||{}).WBProps||{}).date1904;
	for(C = range.s.c; C <= range.e.c; ++C) cols[C] = encode_col(C);
	for(R = range.s.r; R <= range.e.r; ++R) {
		r = [];
		rr = encode_row(R);
		var data_R = dense ? data[R] : [];
		if(data_R) for(C = range.s.c; C <= range.e.c; ++C) {
			ref = cols[C] + rr;
			var _cell = dense ? data_R[C] : ws[ref];
			if(_cell === undefined) continue;
			if((cell = write_ws_xml_cell(_cell, ref, ws, opts, idx, wb, date1904)) != null) r.push(cell);
		}
		if(r.length > 0 || (rows && rows[R])) {
			params = ({r:rr}/*:any*/);
			if(rows && rows[R]) {
				row = rows[R];
				if(row.hidden) params.hidden = 1;
				height = -1;
				if(row.hpx) height = px2pt(row.hpx);
				else if(row.hpt) height = row.hpt;
				if(height > -1) { params.ht = height; params.customHeight = 1; }
				if(row.level) { params.outlineLevel = row.level; }
			}
			o[o.length] = (writextag('row', r.join(""), params));
		}
	}
	if(rows) for(; R < rows.length; ++R) {
		if(rows && rows[R]) {
			params = ({r:R+1}/*:any*/);
			row = rows[R];
			if(row.hidden) params.hidden = 1;
			height = -1;
			if (row.hpx) height = px2pt(row.hpx);
			else if (row.hpt) height = row.hpt;
			if (height > -1) { params.ht = height; params.customHeight = 1; }
			if (row.level) { params.outlineLevel = row.level; }
			o[o.length] = (writextag('row', "", params));
		}
	}
	return o.join("");
}

function write_ws_xml(idx/*:number*/, opts, wb/*:Workbook*/, rels)/*:string*/ {
	var o = [XML_HEADER, writextag('worksheet', null, {
		'xmlns': XMLNS_main[0],
		'xmlns:r': XMLNS.r
	})];
	var s = wb.SheetNames[idx], sidx = 0, rdata = "";
	var ws = wb.Sheets[s];
	if(ws == null) ws = {};
	var ref = ws['!ref'] || 'A1';
	var range = safe_decode_range(ref);
	if(range.e.c > 0x3FFF || range.e.r > 0xFFFFF) {
		if(opts.WTF) throw new Error("Range " + ref + " exceeds format limit A1:XFD1048576");
		range.e.c = Math.min(range.e.c, 0x3FFF);
		range.e.r = Math.min(range.e.c, 0xFFFFF);
		ref = encode_range(range);
	}
	if(!rels) rels = {};
	ws['!comments'] = [];
	var _drawing = [];

	write_ws_xml_sheetpr(ws, wb, idx, opts, o);

	o[o.length] = (writextag('dimension', null, {'ref': ref}));

	o[o.length] = write_ws_xml_sheetviews(ws, opts, idx, wb);

	/* TODO: store in WB, process styles */
	if(opts.sheetFormat) o[o.length] = (writextag('sheetFormatPr', null, {
		defaultRowHeight:opts.sheetFormat.defaultRowHeight||'16',
		baseColWidth:opts.sheetFormat.baseColWidth||'10',
		outlineLevelRow:opts.sheetFormat.outlineLevelRow||'7'
	}));

	if(ws['!cols'] != null && ws['!cols'].length > 0) o[o.length] = (write_ws_xml_cols(ws, ws['!cols']));

	o[sidx = o.length] = '<sheetData/>';
	ws['!links'] = [];
	if(ws['!ref'] != null) {
		rdata = write_ws_xml_data(ws, opts, idx, wb, rels);
		if(rdata.length > 0) o[o.length] = (rdata);
	}
	if(o.length>sidx+1) { o[o.length] = ('</sheetData>'); o[sidx]=o[sidx].replace("/>",">"); }

	/* sheetCalcPr */

	if(ws['!protect']) o[o.length] = write_ws_xml_protection(ws['!protect']);

	/* protectedRanges */
	/* scenarios */

	if(ws['!autofilter'] != null) o[o.length] = write_ws_xml_autofilter(ws['!autofilter'], ws, wb, idx);

	/* sortState */
	/* dataConsolidate */
	/* customSheetViews */

	if(ws['!merges'] != null && ws['!merges'].length > 0) o[o.length] = (write_ws_xml_merges(ws['!merges']));

	/* phoneticPr */
	/* conditionalFormatting */
	/* dataValidations */

	var relc = -1, rel, rId = -1;
	if(/*::(*/ws['!links']/*::||[])*/.length > 0) {
		o[o.length] = "<hyperlinks>";
		/*::(*/ws['!links']/*::||[])*/.forEach(function(l) {
			if(!l[1].Target) return;
			rel = ({"ref":l[0]}/*:any*/);
			if(l[1].Target.charAt(0) != "#") {
				rId = add_rels(rels, -1, escapexml(l[1].Target).replace(/#[\s\S]*$/, ""), RELS.HLINK);
				rel["r:id"] = "rId"+rId;
			}
			if((relc = l[1].Target.indexOf("#")) > -1) rel.location = escapexml(l[1].Target.slice(relc+1));
			if(l[1].Tooltip) rel.tooltip = escapexml(l[1].Tooltip);
			rel.display = l[1].display;
			o[o.length] = writextag("hyperlink",null,rel);
		});
		o[o.length] = "</hyperlinks>";
	}
	delete ws['!links'];

	/* printOptions */

	if(ws['!margins'] != null) o[o.length] =  write_ws_xml_margins(ws['!margins']);

	/* pageSetup */
	/* headerFooter */
	/* rowBreaks */
	/* colBreaks */
	/* customProperties */
	/* cellWatches */

	if(!opts || opts.ignoreEC || (opts.ignoreEC == (void 0))) o[o.length] = writetag("ignoredErrors", writextag("ignoredError", null, {numberStoredAsText:1, sqref:ref}));

	/* smartTags */

	if(_drawing.length > 0) {
		rId = add_rels(rels, -1, "../drawings/drawing" + (idx+1) + ".xml", RELS.DRAW);
		o[o.length] = writextag("drawing", null, {"r:id":"rId" + rId});
		ws['!drawing'] = _drawing;
	}

	if(ws['!comments'].length > 0) {
		rId = add_rels(rels, -1, "../drawings/vmlDrawing" + (idx+1) + ".vml", RELS.VML);
		o[o.length] = writextag("legacyDrawing", null, {"r:id":"rId" + rId});
		ws['!legacy'] = rId;
	}

	/* legacyDrawingHF */
	/* picture */
	/* oleObjects */
	/* controls */
	/* webPublishItems */
	/* tableParts */
	/* extLst */

	if(o.length>1) { o[o.length] = ('</worksheet>'); o[1]=o[1].replace("/>",">"); }
	return o.join("");
}
