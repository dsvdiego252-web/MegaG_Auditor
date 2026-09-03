export const money = (cents: number) => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL',maximumFractionDigits:2}).format(cents/100);
export const compact = (cents: number) => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL',notation:'compact',maximumFractionDigits:2}).format(cents/100);
export const percent = (part: number,total: number) => total ? `${(part / total * 100).toFixed(1).replace('.', ',')}%` : '0,0%';
export const periodLabel = (period: string) => new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${period}-15T12:00:00Z`));
export const categoryLabels = {tributada:'Tributadas',isenta:'Isentas',st:'Subst. tributária',outras:'Outras',revisar:'Revisar'};
