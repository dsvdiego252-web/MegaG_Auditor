export type Direction = 'entrada' | 'saida';
export type Category = 'tributada' | 'isenta' | 'st' | 'outras' | 'revisar';
export type Operation = 'compra' | 'venda' | 'transferencia' | 'outra';
export type Priority = 'alta' | 'media' | 'baixa';
export type Company = { id: string; name: string; uf: string | null; cnpj: string | null; head: boolean };
export type TaxMode = 'confirmar' | 'por-direcao';
export type Entry = {
  id: string; importId: string; companyId: string; period: string; line: number;
  raw: string; cfop: string; direction: Direction; amount: number; base: number;
  tax: number; exempt: number; other: number; taxConfirmed: boolean;
  key?: string; document?: string; counterpart?: string; date?: string;
};
export type Rule = {
  id: string; cfop: string; companyId: string; uf: string; start: string; end: string;
  category: Category; operation: Operation; credit: 'permitir' | 'vedar' | 'revisar';
  expectCredit: boolean; reason: string; reference: string; active: boolean;
};
export type Alert = { id: string; entryId?: string; companyId?: string; priority: Priority; title: string; reason: string; amount?: number; kind: string };
export type Transfer = { id: string; entryIds: string[]; key?: string; amount: number; status: 'Conferido' | 'Revisar' | 'Não encontrado'; reason: string };
export type EvaluatedEntry = Entry & { category: Category; operation?: Operation; ruleId?: string; reasons: string[]; status: 'Conferido' | 'Revisar' };
export type ImportRecord = { id: string; companyId: string; period: string; filename: string; hash: string; rowCount: number; uploadedAt: string; warnings: string[]; taxMode: TaxMode; emptyConfirmed: boolean };
export type Snapshot = { id: string; period: string; processedAt: string; entries: EvaluatedEntry[]; alerts: Alert[]; transfers: Transfer[]; rules: Rule[]; imports: ImportRecord[]; companies: Company[]; inputFingerprint: string; ruleFingerprint: string };
export type AppData = { demo: boolean; companies: Company[]; rules: Rule[]; imports: ImportRecord[]; snapshot: Snapshot | null; stale: boolean; periods: string[] };
export const DEFAULT_COMPANIES: Company[] = [
  {id:'01',name:'Matriz',uf:null,cnpj:null,head:true},
  {id:'02',name:'VGP',uf:null,cnpj:null,head:false},
  {id:'03',name:'MG',uf:null,cnpj:null,head:false},
  {id:'04',name:'ZL',uf:null,cnpj:null,head:false},
  {id:'05',name:'ARA',uf:null,cnpj:null,head:false},
  {id:'06',name:'CCPV',uf:null,cnpj:null,head:false}
];
