import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ParsedEad } from "./ead.types";

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