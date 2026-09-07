const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync(require('node:path').join(__dirname,'EmployeeCreatePage.tsx'),'utf8');
test('staff selector uses authenticated role check and hides Existing Staff only',()=>{
  assert.match(source,/const \{ hasRole \} = useAuth\(\)/);
  const match=source.match(/STAFF_TYPE_OPTIONS\.filter\(([^\n]+)\)\.map/);
  assert.ok(match,'selector must filter unauthorized options');
  const predicate=ts.transpileModule('const predicate = '+match[1],{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  for(const role of ['SUPER_ADMIN','HR_EXECUTIVE','HR_MANAGER','EMPLOYEE',undefined]){
    const hasRole=roles=>roles.includes(role);
    const filter=new Function('hasRole',predicate+';return predicate;')(hasRole);
    assert.deepEqual(['NEW','EXISTING','INTERNEE'].filter(value=>filter({value})),role==='SUPER_ADMIN'?['NEW','EXISTING','INTERNEE']:['NEW','INTERNEE']);
  }
});
