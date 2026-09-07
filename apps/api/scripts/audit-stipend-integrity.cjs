/* Read-only production audit. Run: node scripts/audit-stipend-integrity.cjs
 * Or stream into an already-running API container:
 * docker exec -i -w /app CONTAINER node < audit-stipend-integrity.cjs
 * Offline checks: node scripts/audit-stipend-integrity.cjs --self-test
 * No Nest bootstrap, payroll calls, migration, or data repair.
 */
const components = ['allowances','fuelAllowance','reward','progressReward','loanDeduction','advanceDeduction','fineDeduction','healthDeduction'];
function inspect(employee, audits = []) {
  const records = employee.stipendRecords;
  const issues = [];
  const open = records.filter(r => r.effectiveTo === null);
  if (!open.length) issues.push({kind:'NO_OPEN_PACKAGE'});
  if (open.length > 1) issues.push({kind:'MULTIPLE_OPEN_PACKAGES',packageIds:open.map(r=>r.id)});
  for (const r of records) {
    if (r.effectiveTo !== null && +new Date(r.effectiveTo) < +new Date(r.effectiveFrom)) issues.push({kind:'INVALID_RANGE',packageId:r.id,effectiveFrom:r.effectiveFrom,effectiveTo:r.effectiveTo});
  }
  const valid = records.filter(r => r.effectiveTo === null || +new Date(r.effectiveTo) > +new Date(r.effectiveFrom));
  for(let i=0;i<valid.length;i++) for(let j=i+1;j<valid.length;j++) {
    const a=valid[i],b=valid[j];
    if (+new Date(a.effectiveFrom) < (b.effectiveTo===null?Infinity:+new Date(b.effectiveTo)) && +new Date(b.effectiveFrom) < (a.effectiveTo===null?Infinity:+new Date(a.effectiveTo))) issues.push({kind:'OVERLAP',packageIds:[a.id,b.id]});
  }
  // Compare creation order, not potentially corrected/backdated effective dates.
  const ordered=[...records].sort((a,b)=>+new Date(a.createdAt)-+new Date(b.createdAt));
  for(let i=1;i<ordered.length;i++) for(const field of components) {
    const before=ordered[i-1][field],after=ordered[i][field];
    if(before!=null && Number(before)!==0 && after!=null && Number(after)===0) issues.push({kind:'SUSPICIOUS_COMPONENT_DROP',field,fromPackageId:ordered[i-1].id,toPackageId:ordered[i].id,before:String(before),after:String(after),provenance:'Stored records only; request intent and original values NOT PROVEN'});
  }
  for(const a of audits) {
    const c=a.changes||{};
    if(!c.previousPackage || !c.newPackage) {
      issues.push({kind:'AUDIT_COMPONENT_PROVENANCE_UNAVAILABLE',auditId:a.id,packageId:a.entityId,action:a.action,at:a.createdAt});
      continue;
    }
    for(const field of components) if(c.previousPackage[field]!=null && Number(c.previousPackage[field])!==0 && c.newPackage[field]!=null && Number(c.newPackage[field])===0) issues.push({kind:'AUDITED_COMPONENT_DROP',auditId:a.id,packageId:a.entityId,field,before:c.previousPackage[field],after:c.newPackage[field],explicitlySupplied:Array.isArray(c.suppliedComponents)?c.suppliedComponents.includes(field):null,at:a.createdAt});
  }
  return {employeeCode:employee.employeeCode,employeeName:employee.fullName,issues};
}
async function main(){
  let db;
  try {
    const {PrismaClient}=require(require.resolve('@prisma/client',{paths:[process.cwd(),__dirname]}));
    db=new PrismaClient({log:[]});
    const result=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      const [guard]=await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS mode");
      if(guard.mode!=='on') throw new Error('READ_ONLY_REQUIRED');
      let cursor, count=0; const findings=[]; const counts={};
      do {
        const employees=await tx.employee.findMany({take:200,...(cursor?{cursor:{id:cursor},skip:1}:{}),orderBy:{id:'asc'},select:{id:true,employeeCode:true,fullName:true,stipendRecords:{select:{id:true,createdAt:true,effectiveFrom:true,effectiveTo:true,...Object.fromEntries(components.map(k=>[k,true]))}}}});
        if(!employees.length) break;
        const ids=employees.flatMap(e=>e.stipendRecords.map(r=>r.id));
        const audits=ids.length?await tx.auditLog.findMany({where:{entity:'StipendRecord',entityId:{in:ids},action:{in:['SALARY_INCREMENT','STIPEND_PACKAGE_CORRECTED']}},select:{id:true,entityId:true,action:true,createdAt:true,changes:true}}):[];
        for(const e of employees){count++;const owned=new Set(e.stipendRecords.map(r=>r.id));const report=inspect(e,audits.filter(a=>owned.has(a.entityId)));if(report.issues.length){findings.push(report);for(const issue of report.issues)counts[issue.kind]=(counts[issue.kind]||0)+1;}}
        cursor=employees[employees.length-1].id;
      }while(cursor);
      return {readOnly:true,totalEmployees:count,employeesWithFindings:findings.length,issueCounts:counts,findings,limitations:'Current stored transitions are suspicious, not proof of intent. Old audit records without component before/after values cannot establish omitted versus explicit zero. No historical values are reconstructed.'};
    },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:180000});
    console.log(JSON.stringify(result,null,2));
  }catch{console.error('READ_ONLY_AUDIT_FAILED: no report produced; details withheld to protect credentials.');process.exitCode=1;}
  finally{if(db)await db.$disconnect().catch(()=>{});}
}
function selfTest(){
  const assert=require('node:assert/strict');
  const r={id:'a',createdAt:'2026-01-01',effectiveFrom:'2026-01-01',effectiveTo:null,fuelAllowance:5000};
  const issues=(records,audits=[])=>inspect({employeeCode:'TEST',fullName:'Fixture',stipendRecords:records},audits).issues;
  assert(issues([]).some(i=>i.kind==='NO_OPEN_PACKAGE'));
  assert(issues([r,{...r,id:'b'}]).some(i=>i.kind==='MULTIPLE_OPEN_PACKAGES'));
  assert(issues([{...r,effectiveTo:'2025-01-01'}]).some(i=>i.kind==='INVALID_RANGE'));
  assert(issues([r,{...r,id:'b',effectiveFrom:'2026-02-01'}]).some(i=>i.kind==='OVERLAP'));
  assert(issues([r,{...r,id:'b',createdAt:'2026-02-01',fuelAllowance:0}]).some(i=>i.kind==='SUSPICIOUS_COMPONENT_DROP'));
  assert(!issues([{...r,effectiveTo:'2026-02-01'},{...r,id:'b',effectiveFrom:'2026-02-01'}]).some(i=>i.kind==='OVERLAP'));
  assert(issues([r],[{changes:{},action:'SALARY_INCREMENT'}]).some(i=>i.kind==='AUDIT_COMPONENT_PROVENANCE_UNAVAILABLE'));
  assert.equal(issues([r],[{changes:{previousPackage:{fuelAllowance:5000},newPackage:{fuelAllowance:0},suppliedComponents:['fuelAllowance']}}]).find(i=>i.kind==='AUDITED_COMPONENT_DROP').explicitlySupplied,true);
  console.log('8 read-only audit fixture checks passed; no database connection.');
}
if(process.argv.includes('--self-test'))selfTest();else main();
