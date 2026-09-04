import type {TaxFacts,TaxFinding,TaxPackage,TaxRule} from './tax-motor';
import type {CfopAnalysis,Reconciliation,AuditSettings} from './movement-audit';
import type {CfopMasterRule,FiscalPermission} from './cfop-master';
export type Direction = 'entrada' | 'saida';
export type Category = 'tributada' | 'isenta' | 'st' | 'outras' | 'revisar';
export type Operation = 'compra' | 'venda' | 'transferencia' | 'outra';
export type Priority = 'alta' | 'media' | 'baixa';
export type Company = { id: string; name: string; uf: string | null; cnpj: string | null; head: boolean; legalName?:string; cnae?:string; regime?:string; registrationSource?:{filename:string;sha256:string;line:number} };
export type TaxMode = 'confirmar' | 'por-direcao';
export type Entry = {
  id: string; importId: string; companyId: string; period: string; line: number;
  raw: string; cfop: string; direction: Direction; amount: number; base: number;
  tax: number; exempt: number; other: number; taxConfirmed: boolean;
  taxLabel?:string; taxMapping?:'cabecalho'|'confirmacao'|'pendente';
  key?: string; document?: string; counterpart?: string; date?: string;
  fiscal?:TaxFacts;
  sourceKind?:'consinco'|'efd-icms';granularity?:'agregado'|'documento'|'c190'|'item';directionDeclared?:Direction;
  stBase?:number;stTax?:number;reportedParts?:{tributada?:number;st?:number};
  documentGroup?:string;documentAmount?:number;itemId?:string;items?:Entry[];itemDiscount?:number;counterpartyCnpj?:string;documentSource?:{raw:string;line:number;base:number;tax:number};
};
export type Rule = {
  id: string; cfop: string; companyId: string; uf: string; start: string; end: string;
  category: Category; operation: Operation; credit: 'permitir' | 'vedar' | 'revisar';
  debit?:FiscalPermission; expectCredit: boolean; reason: string; reference: string; active: boolean;
  pairedCfops?:string[];
};
export type Alert = { action?:string;period?:string;cfop?:string;cst?:string;ruleId?:string;reference?:string; id: string; entryId?: string; companyId?: string; priority: Priority; title: string; reason: string; amount?: number; kind: string };
export type UfCheck={status:'Pendente'|'Conferido'|'Divergente';reason:string};
export type TransferCfop = {ufCheck?:UfCheck;id:string;companyId:string;cfop:string;direction:Direction;amount:number;tax:number;entryIds:string[];status:'Conferido'|'Revisar';description:string;reasons:string[];reference:string};
export type PeriodDeclaration={companyId:string;period:string;noMovement:true;reason:string;declaredBy:string;declaredAt:string};
export type Transfer = { cfopStatus?:'Conferido'|'Revisar'; id: string; entryIds: string[]; key?: string; amount: number; status: 'Conferido' | 'Revisar' | 'Não encontrado'; reason: string };
export type EvaluatedEntry = Entry & { cfopAnalysis?:CfopAnalysis; taxFindings?:TaxFinding[]; ufCheck?:UfCheck; category: Category; operation?: Operation; ruleId?: string; reasons: string[]; status: 'Conferido' | 'Revisar' };
export type ImportRecord = { sourceKind?:'consinco'|'efd-icms';assessment?:{debit:number;credit:number;raw:string;line:number};coverageWarnings?:string[]; id: string; companyId: string; period: string; filename: string; hash: string; rowCount: number; uploadedAt: string; warnings: string[]; taxMode: TaxMode; emptyConfirmed: boolean };
export type Snapshot = { masterRules?:CfopMasterRule[];auditSettings?:AuditSettings;reconciliations?:Reconciliation[]; taxRules?:TaxRule[];taxPackages?:TaxPackage[]; transferCfops?:TransferCfop[]; declarations?:PeriodDeclaration[]; id: string; period: string; processedAt: string; entries: EvaluatedEntry[]; alerts: Alert[]; transfers: Transfer[]; rules: Rule[]; imports: ImportRecord[]; companies: Company[]; inputFingerprint: string; ruleFingerprint: string };
export type AppData = { auditSettings?:AuditSettings;auditSettingsVersion?:number;cfopInstalled?:boolean; taxRules?:TaxRule[];taxPackages?:TaxPackage[]; declarations?:PeriodDeclaration[]; demo: boolean; companies: Company[]; rules: Rule[]; imports: ImportRecord[]; snapshot: Snapshot | null; stale: boolean; periods: string[] };
export const DEFAULT_COMPANIES: Company[] = [
  {id:'01',name:'Matriz',uf:null,cnpj:null,head:true},
  {id:'02',name:'VGP',uf:null,cnpj:null,head:false},
  {id:'03',name:'MG',uf:null,cnpj:null,head:false},
  {id:'04',name:'ZL',uf:null,cnpj:null,head:false},
  {id:'05',name:'ARA',uf:null,cnpj:null,head:false},
  {id:'06',name:'CCPV',uf:null,cnpj:null,head:false}
];
