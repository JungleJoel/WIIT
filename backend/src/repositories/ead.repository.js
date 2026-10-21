const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // å ä ö -> a a o, robust for composed/decomposed forms
    .trim()
    .toLowerCase();

// structuralunit nodes are told apart by <didnote localtype="structuralunitdescription">
const CLASSIFICATION_TYPES = {
  verksamhetsomrade: { code: "verksamhetsomrade", name: "Verksamhetsområde" },
  processgrupp: { code: "processgrupp", name: "Processgrupp" },
  process: { code: "process", name: "Process" },
};

const EAD_LEVELS = new Set([
  "collection", "fonds", "class", "recordgrp", "series", "subfonds",
  "subgrp", "subseries", "file", "item", "otherlevel",
]);

const KNOWN_OTHERLEVEL_NAMES = {
  recordgroup: "Record group (EAD)",
  recordtype: "Record type (EAD)",
};

const STRUCTURE_TYPE = "klassificering";

// Rare EAD elements are stored as custom fields (custom_field_definitions +
// classification_node_custom_values) instead of dedicated columns.
const CUSTOM_FIELDS = {
  physloc: { fieldName: "physloc", displayName: "Physical location (physloc)", dataType: "text" },
  legalstatus: { fieldName: "legalstatus", displayName: "Legal status (legalstatus)", dataType: "text" },
  relation: { fieldName: "relation", displayName: "Related link (relation)", dataType: "json" },
  unitid: { fieldName: "extra_unitid", displayName: "Additional identifier (unitid)", dataType: "text" },
};

class EadRepository {
  constructor(knex) {
    this.knex = knex;
  }

  /**
   * Decide the application node type from the EAD attributes + didnote.
   * Returns what is needed both to look up and to create the node_types row.
   */
  getNodeTypeInfo(node) {
    const otherlevel = norm(node.otherlevel);
    const level = norm(node.level);

    if (otherlevel === "structuralunit") {
      const known = CLASSIFICATION_TYPES[norm(node.structuralUnitDescription)];

      if (known) {
        return { ...known, eadLevel: "otherlevel", eadOtherlevel: "structuralunit", known: true };
      }

      return {
        code: "structuralunit",
        name: "Structural unit (EAD)",
        eadLevel: "otherlevel",
        eadOtherlevel: "structuralunit",
        known: false,
      };
    }

    const code = otherlevel || level;

    if (!code || code === "otherlevel") {
      throw new Error(`Cannot determine EAD node type for "${node.name}".`);
    }

    // A real EAD level (file, series ...) without @otherlevel
    if (!otherlevel && EAD_LEVELS.has(level) && level !== "otherlevel") {
      return { code, name: `${code} (EAD)`, eadLevel: level, eadOtherlevel: null, known: true };
    }

    return {
      code,
      name: KNOWN_OTHERLEVEL_NAMES[code] || `${node.otherlevel || node.level} (EAD)`,
      eadLevel: "otherlevel",
      eadOtherlevel: node.otherlevel || node.level,
      known: true,
    };
  }

  async findOrCreateStructure(name, metadata = {}, db = this.knex, extra = {}) {
    const structureName = String(name || "").trim();
    if (!structureName) throw new Error("A structure name is required.");

    const existing = await db("structures")
      .where({ name: structureName, structure_type: STRUCTURE_TYPE })
      .first();
    if (existing) return existing.id;

    const code =
      "EAD-" + Date.now().toString(36).toUpperCase() + "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    const inserted = await db("structures").insert(
      {
        code,
        name: structureName,
        structure_type: STRUCTURE_TYPE,
        agency_name: metadata.agencyName || "Unknown",
        language_code: (metadata.languageCode || "swe").slice(0, 3),
        version: extra.version || metadata.edition || null,
        description: extra.description || null,
        valid_from: extra.validFrom || null,
      },
      ["id"]
    );
    return inserted[0].id;
  }

  /**
   * Import one EAD document.
   *
   * <archdesc> is not a node. Under <dsc> this export has two branches:
   *   - otherlevel="classificationstructure"  -> THE structure (its children are
   *     the top nodes: Verksamhetsområde ...). Its own data (title, version,
   *     scopecontent) goes on the structures row, not into nodes.
   *   - otherlevel="recordkeepingentity"      -> storage / system tree
   *     (Strukturenhet, Verksamhetssystem, Svit ...). NOT a classification tree;
   *     skipped here and reported, so it does not pollute the klassificering tree.
   */
  async importDocument({
    structureId,
    structureName,
    metadata = {},
    rootNode,
    sourceFileName = null,
  }) {
    if (!rootNode) throw new Error("The EAD document has no root node.");
    if (!structureId && !structureName) {
      throw new Error("Either structureId or structureName is required.");
    }

    const branches = rootNode.children || [];
    const wrapper = branches.find((n) => norm(n.otherlevel) === "classificationstructure");
    const isStorage = (n) => norm(n.otherlevel) === "recordkeepingentity";
    const topNodes = wrapper ? wrapper.children || [] : branches.filter((n) => !isStorage(n));
    const skippedBranches = branches
      .filter((n) => n !== wrapper && isStorage(n))
      .map((n) => ({ name: n.name, otherlevel: n.otherlevel, eadId: n.eadId }));

    const warnings = [];

    return this.knex.transaction(async (trx) => {
      let targetStructureId = structureId;

      if (!targetStructureId) {
        targetStructureId = await this.findOrCreateStructure(
          structureName,
          metadata,
          trx,
          {
            version: wrapper?.unitidLabel,
            description: wrapper?.scopeContent,
            validFrom: wrapper?.validFrom,
          }
        );
      }

      const structure = await trx("structures")
        .where({ id: targetStructureId, structure_type: STRUCTURE_TYPE })
        .first();
      if (!structure) {
        throw new Error("The selected classification structure does not exist.");
      }

      // node_types.code is UNIQUE across all structure types, so cache by code only.
      const typeCache = new Map(
        (await trx("node_types").select("id", "code", "structure_type")).map((t) => [t.code, t])
      );

      const resolveType = async (info) => {
        const cached = typeCache.get(info.code);
        if (cached) {
          if (cached.structure_type !== STRUCTURE_TYPE) {
            throw new Error(
              `Node type "${info.code}" already exists for structure type "${cached.structure_type}".`
            );
          }
          return cached.id;
        }
        const inserted = await trx("node_types").insert(
          {
            code: info.code,
            name: info.name,
            structure_type: STRUCTURE_TYPE,
            ead_level: info.eadLevel,
            ead_otherlevel: info.eadOtherlevel,
            description: null,
            is_active: true,
          },
          ["id"]
        );
        typeCache.set(info.code, { id: inserted[0].id, code: info.code, structure_type: STRUCTURE_TYPE });
        return inserted[0].id;
      };

      // the three standard types always exist, even if the file lacks one of them
      for (const def of Object.values(CLASSIFICATION_TYPES)) {
        await resolveType({ ...def, eadLevel: "otherlevel", eadOtherlevel: "structuralunit" });
      }

      const usedReferenceCodes = new Set(
        (await trx("nodes")
          .where({ structure_id: targetStructureId })
          .whereNotNull("reference_code")
          .select("reference_code")
        ).map((r) => String(r.reference_code).trim())
      );

      const documentRows = await trx("ead_documents").insert(
        {
          structure_id: targetStructureId,
          record_id: metadata.recordId || null,
          title_proper: metadata.titleProper || rootNode.name || null,
          edition: metadata.edition || null,
          agency_name: metadata.agencyName || null,
          country_code: metadata.countryCode || null,
          language_code: metadata.languageCode || null,
          script_code: metadata.scriptCode || null,
          publication_status: metadata.publicationStatus || null,
          source_file_name: sourceFileName,
        },
        ["id"]
      );
      const documentId = documentRows[0].id;

      const propertyRows = [];
      const refRows = [];
      const eadIdToNodeId = new Map();
      let importedNodeCount = 0;
      let duplicateReferenceCodes = 0;

      const insertNode = async (node, parentId, siblingIndex) => {
        if (!node || !node.name) throw new Error("A classification node is missing its name.");

        const info = this.getNodeTypeInfo(node);
        if (!info.known) {
          warnings.push({
            message: `"${node.name}": unknown structuralunitdescription "${node.structuralUnitDescription}"; stored as generic structural unit.`,
          });
        }
        const nodeTypeId = await resolveType(info);

        // unit_id keeps the original <unitid> always. reference_code has a unique
        // index per structure, and ids like "HS" / "HT1" repeat, so it is only set
        // when unique.
        let referenceCode = node.unitid ? String(node.unitid).trim() : null;
        if (referenceCode) {
          if (usedReferenceCodes.has(referenceCode)) {
            referenceCode = null;
            duplicateReferenceCodes += 1;
          } else {
            usedReferenceCodes.add(referenceCode);
          }
        }

        const insertedRows = await trx("nodes").insert(
          {
            structure_id: targetStructureId,
            parent_id: parentId,
            node_type_id: nodeTypeId,
            reference_code: referenceCode,
            unit_id: node.unitid || null,
            unit_id_label: node.unitidLabel || null,
            structural_unit_description: node.structuralUnitDescription || null,
            access_restrict: node.accessRestrict || null,
            title: node.name,
            sort_order: siblingIndex,
            is_published: false,
            external_id: null,
            description: node.description || null, // only <abstract>; the type is NOT a description
            previous_reference_code: null,
            ead_document_id: documentId,
            ead_id: node.eadId || null,
            scope_content: node.scopeContent || null,
            appraisal: node.appraisal || null,
            ead_audience: node.audience || null,
            local_type: node.otherlevel || node.level || null,
            modified_at: node.modifiedAt || null,
            modified_by: node.modifiedBy || null,
            valid_from: node.validFrom || null,
            valid_to: node.validTo || null,
          },
          ["id"]
        );

        const nodeId = insertedRows[0].id;
        importedNodeCount += 1;
        if (node.eadId) eadIdToNodeId.set(node.eadId, nodeId);

        for (const p of node.properties || []) {
          const field = CUSTOM_FIELDS[p.element];
          if (!field || !p.value) continue;

          propertyRows.push({
            nodeId,
            field,
            value:
              field.dataType === "json"
                ? JSON.stringify({ href: p.value, title: p.label, type: p.localtype })
                : p.value,
          });
        }
        for (const r of node.refs || []) {
          refRows.push({
            node_id: nodeId, target_ead_id: r.targetEadId, label: r.label,
            link_role: r.linkRole, target_node_id: null,
          });
        }

        let index = 0;
        for (const childNode of node.children || []) {
          await insertNode(childNode, nodeId, index++);
        }
      };

      let top = 0;
      for (const node of topNodes) {
        await insertNode(node, null, top++);
      }

      // links to nodes that exist in this import can be resolved right away;
      // the rest (e.g. the skipped storage tree) keep target_ead_id for later.
      for (const r of refRows) {
        r.target_node_id = eadIdToNodeId.get(r.target_ead_id) || null;
      }

      const batch = (table, rows) =>
        rows.length ? this.knex.batchInsert(table, rows, 100).transacting(trx) : Promise.resolve();

      // custom field definitions: reuse the structure's, create what is missing
      const definitionIds = new Map(
        (await trx("custom_field_definitions")
          .where({ structure_id: targetStructureId })
          .select("id", "field_name")
        ).map((d) => [d.field_name, d.id])
      );

      for (const { field } of propertyRows) {
        if (definitionIds.has(field.fieldName)) continue;
        const inserted = await trx("custom_field_definitions").insert(
          {
            structure_id: targetStructureId,
            field_name: field.fieldName,
            display_name: field.displayName,
            data_type: field.dataType,
            is_required: false,
          },
          ["id"]
        );
        definitionIds.set(field.fieldName, inserted[0].id);
      }

      await batch(
        "classification_node_custom_values",
        propertyRows.map((r) => ({
          node_id: r.nodeId,
          custom_field_definition_id: definitionIds.get(r.field.fieldName),
          value: r.value,
        }))
      );
      await batch("node_ead_refs", refRows);

      if (duplicateReferenceCodes) {
        warnings.push({
          message: `${duplicateReferenceCodes} repeated unitid values were not used as reference_code (unique index); they are kept in nodes.unit_id.`,
        });
      }
      if (skippedBranches.length) {
        warnings.push({
          message: `Skipped ${skippedBranches.length} non-classification branch(es): ${skippedBranches.map((b) => b.otherlevel).join(", ")}.`,
        });
      }

      return {
        structureId: targetStructureId,
        documentId,
        importedNodeCount,
        skippedBranches,
        warnings,
      };
    });
  }

  /**
   * Rebuild the tree of a structure from the saved rows.
   */
  async getTree(structureId) {
    const rows = await this.knex("nodes as n")
      .join("node_types as t", "t.id", "n.node_type_id")
      .where("n.structure_id", structureId)
      .select(
        "n.id", "n.parent_id", "n.sort_order", "n.title", "n.unit_id", "n.unit_id_label",
        "n.reference_code", "n.ead_id", "n.local_type", "n.structural_unit_description",
        "n.scope_content", "n.appraisal", "n.access_restrict", "n.description",
        "n.modified_at", "n.modified_by", "n.ead_audience", "n.valid_from", "n.valid_to",
        "t.code as type_code", "t.name as type_name", "t.ead_level", "t.ead_otherlevel"
      )
      .orderBy([{ column: "n.parent_id" }, { column: "n.sort_order" }]);

    const customValues = await this.knex("classification_node_custom_values as v")
      .join("custom_field_definitions as d", "d.id", "v.custom_field_definition_id")
      .join("nodes as n", "n.id", "v.node_id")
      .where("n.structure_id", structureId)
      .select("v.node_id", "d.field_name", "v.value");

    const valuesByNode = new Map();
    for (const v of customValues) {
      if (!valuesByNode.has(v.node_id)) valuesByNode.set(v.node_id, []);
      valuesByNode.get(v.node_id).push({ field: v.field_name, value: v.value });
    }

    const byId = new Map(
      rows.map((r) => [
        r.id,
        { ...r, customValues: valuesByNode.get(r.id) || [], children: [] },
      ])
    );
    const roots = [];
    for (const node of byId.values()) {
      const parent = node.parent_id == null ? null : byId.get(node.parent_id);
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }
}

module.exports = { EadRepository };
