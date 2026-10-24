import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ParsedEad } from "./ead.types";

/**
 * Turns the text of an uploaded EAD file into a plain JS object (fast-xml-parser).
 *
 * D3 (XXE): files with DOCTYPE or ENTITY declarations are rejected, and entities are not
 * expanded by the parser (processEntities: false). eadMapper.ts decodes the few standard
 * entities itself.
 */
export class EadParser {
  private readonly parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
      processEntities: false,
    });
  }

  /**
   * Parses one EAD document. Namespace prefixes are removed, so EAD3 and RA-EAD files give
   * the same element names.
   *
   * @throws Error if the text is empty, contains DOCTYPE/ENTITY, is not well-formed XML,
   *   or has no <ead> root element.
   */
  parse(xml: unknown): ParsedEad {
    if (typeof xml !== "string" || !xml.trim()) {
      throw new Error("The XML file is empty.");
    }

    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
      throw new Error("DOCTYPE and ENTITY declarations are not allowed.");
    }

    const validation = XMLValidator.validate(xml);

    if (validation !== true) {
      throw new Error("The uploaded file contains invalid XML.");
    }

    let parsed: ParsedEad;

    try {
      parsed = this.parser.parse(xml) as ParsedEad;
    } catch {
      throw new Error("The XML file could not be parsed.");
    }

    if (!parsed || typeof parsed !== "object" || !parsed.ead) {
      throw new Error("The XML document must have an EAD root element.");
    }

    return parsed;
  }
}