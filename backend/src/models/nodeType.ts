export interface NodeType {
  id: number;
  code: string;       // e.g., 'serie', 'volym', 'hylla'
  name: string;       // e.g., 'Serie', 'Volym'
  structureType: string;
  eadLevel: string;   // Maps to EAD3 level attributes
  eadOtherlevel?: string;
}
