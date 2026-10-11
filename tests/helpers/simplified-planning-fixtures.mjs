// Strictly fictional current contract; never opens a library.
export function simplifiedSources(contribution = null) {
 const generation='fictional-simplified', today='2026-10-12';
 return {generation,write_version:1,today,modules:{planning:true,wealth:false},
 profile:{status:'ready',value:{generation,saved:{revision:1,updated_at:today+'T00:00:00Z',profile:{assumptions:{inflation_hundredths:0},retire:{
 setup_completed:true,simplified:{contract_version:1,time:{reference:null,target_month:'2027-01',horizon_month:'2028-01'},income_mode:'excluded',future_incomes:[]},
 basic:{contract_version:1,start:{kind:'simulation',id:'fictional-start',available_cents:'10000',date:'2026-10-31',notes:'虚构'},contribution:{id:'fictional-contribution',monthly_cents:contribution},contribution_costs:[],retirement_costs:[]},
 core:{contract_version:1,monetary_basis_date:'2026-10-31',fund_rules:[],releases:[],occurrences:[],debt_repayments:[]},
 spend_cents:'1000',real_return_before_hundredths:0,real_return_after_hundredths:0,emergency_months:0,mode:'traditional',volatility_hundredths:500,spend_items:[],life_events:[],rent_cents:'0'
 }}}}},snapshot:{status:'ready',value:null},accounts:{status:'ready',value:[]},review:{status:'error',value:{code:'fictional',message:'虚构历史未知'}},incomes:{status:'ready',value:[]}};
}
export const fictionalFutureIncome = overrides => ({id:'fictional-income',name:'虚构租金',role:'other',included:true,monthly_cents:'100',start_month:'2027-01',end_month:null,basis:'start_month',basis_month:null,growth:'fixed_nominal',source:null,source_checked_on:null,notes:'',...overrides});
