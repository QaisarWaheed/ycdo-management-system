const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const file = path.join(__dirname, 'stipendUtils.ts');
const mod = new Module(file, module);
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, file);
test('Current package ignores later closed history',()=>{
  const open={id:'open',effectiveFrom:'2026-08-01',effectiveTo:null};
  const closed={id:'closed',effectiveFrom:'2026-08-12',effectiveTo:'2026-08-01'};
  assert.equal(mod.exports.selectCurrentStipend([closed,open]),open);
  assert.equal(mod.exports.selectCurrentStipend([closed]),undefined);
  assert.equal(mod.exports.selectCurrentStipend([]),undefined);
});
test('Profile and Edit Payroll share the current package selection',()=>{
  const tab=fs.readFileSync(path.join(__dirname,'../components/employees/EmployeePayrollTab.tsx'),'utf8');
  const profile=fs.readFileSync(path.join(__dirname,'../pages/employees/EmployeeProfilePage.tsx'),'utf8');
  assert.match(tab,/latestStipend = selectCurrentStipend\(stipendRecords\)/);
  assert.match(tab,/latestStipend=\{latestStipend\}/);
  assert.match(profile,/latestStipend = selectCurrentStipend\(stipends\)/);
});
