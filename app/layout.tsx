import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Mega G — Auditor Fiscal',description:'Auditoria mensal de ICMS, importação Consinco e rastreabilidade por competência.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body>{children}</body></html>;}
