// parser.js
const fs = require("fs/promises");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

// ---------------------------------------------------------------------------
// Parser configuration — full fidelity, arrays for repeatables
// ---------------------------------------------------------------------------
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
  preserveOrder: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  cdataPropName: false,
  isArray: (name) =>
    [
      "c", "c01", "c02", "c03", "c04", "c05", "c06",
      "didnote", "unitid", "unittitle", "unitdate",
      "scopecontent", "appraisal", "accessrestrict",
      "legalstatus", "abstract", "relations", "relation",
      "bioghist", "arrangement", "accruals", "custodhist",
      "acqinfo", "altformavail", "originalsloc", "prefercite",
      "processinfo", "separatedmaterial", "userestrict", "odd",
      "note", "p", "list", "item", "maintenanceevent",
      "conventiondeclaration", "localcontrol", "languagedeclaration",
      "language", "script", "agencyname", "corpname", "persname",
      "famname", "geogname", "subject", "function", "occupation",
      "genreform", "physdesc", "physloc", "physfacet", "extent",
      "dimensions", "materialspec", "ref", "ptr", "link",
      "head", "num", "date", "eventdatetime", "agent",
      "eventtype", "agenttype", "term", "part",
    ].includes(name),
};

// ---------------------------------------------------------------------------
// Custom field definitions — the logical fields for
// classification_node_custom_values
// ---------------------------------------------------------------------------
const CUSTOM_FIELD_DEFS = [
  { field_name: "modified",                    display_name: "Modified",                     data_type: "datetime", is_required: false },
  { field_name: "modified_by",                 display_name: "Modified by",                  data_type: "string",   is_required: false },
  { field_name: "appraisal",                   display_name: "Appraisal / gallring",         data_type: "string",   is_required: false },
  { field_name: "access_restrict",             display_name: "Access restriction",           data_type: "string",   is_required: false },
  { field_name: "relation_href",               display_name: "Relation URL",                 data_type: "string",   is_required: false },
  { field_name: "relation_title",              display_name: "Relation title",               data_type: "string",   is_required: false },
  { field_name: "relation_target",             display_name: "Relation target ID",           data_type: "string",   is_required: false },
  { field_name: "relation_role",               display_name: "Relation role",                data_type: "string",   is_required: false },
  { field_name: "structural_unit_description", display_name: "Structural unit description",  data_type: "string",   is_required: false },
  { field_name: "unitid_extra",                display_name: "Additional unit ID",           data_type: "string",   is_required: false },
  { field_name: "scope_paragraph",             display_name: "Scope paragraph (extra)",      data_type: "string",   is_required: false },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function parseEADFile(fileName) {
  const filePath = path.resolve(__dirname, fileName);
  const xmlString = await fs.readFile(filePath, "utf-8");
  return parseEADString(xmlString, { sourceFileName: fileName });
}

function parseEADString(xmlString, { sourceFileName = null } = {}) {
  const parser = new XMLParser(PARSER_OPTIONS);
  const root = parser.parse(xmlString).ead;
  if (!root) throw new Error("No <ead> root element found");

  // -------------------------------------------------------------------------
  // 1. ead_documents (metadata)
  // -------------------------------------------------------------------------
  const control = root.control || {};
  const filedesc = control.filedesc || {};
  const titlestmt = filedesc.titlestmt || {};
  const editionstmt = filedesc.editionstmt || {};

  const metadata = {
    record_id:           text(control.recordid),
    title_proper:        text(titlestmt.titleproper),
    edition:             text(editionstmt.edition),
    agency_name:         text(control.maintenanceagency?.agencyname),
    agency_code:         text(control.maintenanceagency?.agencycode),
    maintenance_status:  attr(control.maintenancestatus, "@_value"),
    language:            text(control.languagedeclaration?.language),
    language_code:       attr(control.languagedeclaration?.language, "@_langcode"),
    script:              text(control.languagedeclaration?.script),
    script_code:         attr(control.languagedeclaration?.script, "@_scriptcode"),
    country_code:        attr(control, "@_countryencoding"),
    date_encoding:       attr(control, "@_dateencoding"),
    lang_encoding:       attr(control, "@_langencoding"),
    script_encoding:     attr(control, "@_scriptencoding"),
    repository_encoding: attr(control, "@_repositoryencoding"),
    source_file_name:    sourceFileName,
    source_xml:          xmlString,
    import_status:       "pending",
    validation_errors:   null,
    ead_version:         null,
  };

  // -------------------------------------------------------------------------
  // 2. classification_structure (one per file)
  // -------------------------------------------------------------------------
  const classificationStructure = {
    name:        metadata.title_proper || "Unnamed structure",
    description: metadata.title_proper,
    valid_from:  null,
    valid_to:    null,
  };

  // -------------------------------------------------------------------------
  // 3. classification_nodes + custom values
  // -------------------------------------------------------------------------
  const classificationNodes = [];
  const customFieldValues  = [];

  function walk(node, parentEadId = null, depth = 0) {
    if (!node) return;
    const items = Array.isArray(node) ? node : [node];

    for (const comp of items) {
      if (!comp || typeof comp !== "object") continue;

      const eadId = attr(comp, "@_id");
      const did   = comp.did || {};

      const nodeType = comp["@_otherlevel"]
        ? `${comp["@_level"] || "otherlevel"}:${comp["@_otherlevel"]}`
        : (comp["@_level"] || "unknown");

      classificationNodes.push({
        _parentEadId:         parentEadId,
        _depth:               depth,
        ead_id:               eadId,
        node_type:            nodeType,
        name:                 firstText(did.unittitle) || firstText(did.unitid) || `(unnamed ${eadId})`,
        unitid:               firstText(did.unitid),
        ead_level:            attr(comp, "@_level"),
        ead_otherlevel:       attr(comp, "@_otherlevel"),
        ead_audience:         attr(comp, "@_audience"),
        previous_designation: null,
        valid_from:           text(did.unitdatestructured?.daterange?.fromdate) || null,
        valid_to:             text(did.unitdatestructured?.daterange?.todate)   || null,
        description:          firstText(comp.scopecontent),
        scope_content:        firstText(comp.scopecontent),
        appraisal:            firstText(comp.appraisal),
        local_type:           null,
      });

      const push = (fieldName, value, position = 0) => {
        if (value == null || value === "") return;
        customFieldValues.push({
          _nodeEadId: eadId,
          field_name: fieldName,
          value:      String(value),
          position,
        });
      };

      for (const u of toArray(did.unitid)) {
        const lt = attr(u, "@_localtype");
        if (lt === "modified")   push("modified",    text(u));
        if (lt === "modifiedby") push("modified_by", text(u));
        if (!lt && text(u) !== firstText(did.unitid)) push("unitid_extra", text(u));
      }

      toArray(comp.appraisal).forEach((a, i) => push("appraisal", text(a), i));

      const arList = [
        ...toArray(comp.accessrestrict),
        ...toArray(comp.archdesc?.accessrestrict),
      ];
      arList.forEach((ar, i) => push("access_restrict", text(ar) || text(ar?.note?.p), i));

      toArray(comp.relations?.relation).forEach((rel) => {
        if (attr(rel, "@_href"))      push("relation_href",   attr(rel, "@_href"));
        if (attr(rel, "@_linktitle")) push("relation_title",  attr(rel, "@_linktitle"));
        if (attr(rel, "@_target"))    push("relation_target", attr(rel, "@_target"));
        if (attr(rel, "@_linkrole"))  push("relation_role",   attr(rel, "@_linkrole"));
      });

      toArray(did.didnote).forEach((n) => {
        if (attr(n, "@_localtype") === "structuralunitdescription") {
          push("structural_unit_description", text(n));
        }
      });

      const scopeParas = toArray(comp.scopecontent?.p);
      for (let i = 1; i < scopeParas.length; i++) {
        push("scope_paragraph", text(scopeParas[i]), i);
      }

      for (const key of ["c", "c01", "c02", "c03", "c04", "c05", "c06"]) {
        if (comp[key]) walk(comp[key], eadId, depth + 1);
      }
    }
  }

  if (root.archdesc?.dsc) {
    for (const key of ["c", "c01", "c02", "c03", "c04", "c05", "c06"]) {
      if (root.archdesc.dsc[key]) walk(root.archdesc.dsc[key], null, 0);
    }
  }

  // -------------------------------------------------------------------------
  // 4. storage_units
  // -------------------------------------------------------------------------
  const storageUnits = [];

  function walkRk(node, parentEadId = null, depth = 0) {
    if (!node) return;
    const items = Array.isArray(node) ? node : [node];

    for (const comp of items) {
      if (!comp || typeof comp !== "object") continue;

      const eadId = attr(comp, "@_id");
      const did   = comp.did || {};

      storageUnits.push({
        _parentEadId: parentEadId,
        _depth:       depth,
        ead_id:       eadId,
        name:         firstText(did.unittitle) || firstText(did.unitid) || `(unnamed ${eadId})`,
        unit_type:    attr(comp, "@_otherlevel") || attr(comp, "@_level") || "unknown",
        time_from:    text(did.unitdatestructured?.daterange?.fromdate) || null,
        time_to:      text(did.unitdatestructured?.daterange?.todate)   || null,
        description:  firstText(comp.scopecontent),
        ead_audience: attr(comp, "@_audience"),
      });

      for (const key of ["c", "c01", "c02", "c03", "c04", "c05", "c06"]) {
        if (comp[key]) walkRk(comp[key], eadId, depth + 1);
      }
    }
  }

  if (root.archdesc?.Units || root.archdesc?.units) {
    walkRk(root.archdesc.Units || root.archdesc.units, null, 0);
  }
  if (root.Units || root.units) {
    walkRk(root.Units || root.units, null, 0);
  }

  // -------------------------------------------------------------------------
  // 5. Return — 1:1 with schema tables
  // -------------------------------------------------------------------------
  return {
    ead_document:             metadata,
    classification_structure: classificationStructure,
    classification_nodes:     classificationNodes,
    custom_field_values:      customFieldValues,
    custom_field_definitions: CUSTOM_FIELD_DEFS,
    storage_units:            storageUnits,
    archives:                          [],
    archive_creators:                  [],
    archive_classification_structures: [],
    archive_series:                    [],
    archive_volumes:                   [],
    fe_structures:                     [],
    fe_structure_units:                [],
  };
}

// ---------------------------------------------------------------------------
// Write parser output to a JSON file
// ---------------------------------------------------------------------------
async function writeJson(output, fileName = "parsed-ead.json") {
  const filePath = path.resolve(__dirname, fileName);
  await fs.writeFile(filePath, JSON.stringify(output, null, 2), "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function text(node) {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object" && "#text" in node) return node["#text"];
  return null;
}

function firstText(node) { return text(toArray(node)[0]); }

function attr(node, name) {
  if (node == null) return null;
  if (Array.isArray(node)) return attr(node[0], name);
  if (typeof node === "object") return node[name] ?? null;
  return null;
}

function toArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

module.exports = { parseEADFile, parseEADString, writeJson };

// ---------------------------------------------------------------------------
// Run + save (only when executed directly, not when required as a module)
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const parsed = await parseEADFile("IHP.xml");

    console.log("✅ Parsed IHP.xml");
    console.log(`   ead_document:             ${Object.keys(parsed.ead_document).length} fields`);
    console.log(`   classification_nodes:     ${parsed.classification_nodes.length}`);
    console.log(`   custom_field_values:      ${parsed.custom_field_values.length}`);
    console.log(`   custom_field_definitions: ${parsed.custom_field_definitions.length}`);
    console.log(`   storage_units:            ${parsed.storage_units.length}`);

    const out = await writeJson(parsed, "parsed-ead.json");
    console.log(`💾 Saved to ${out}`);
  })().catch((err) => {
    console.error("❌ Failed:", err);
    process.exitCode = 1;
  });
}
