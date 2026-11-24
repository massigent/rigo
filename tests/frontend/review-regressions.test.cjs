// Independent review regressions for task 001. These must fail until 001b is fixed.
// Drive production only through the existing harness and DOM events.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp,deferRoute,deferred,jsonResponse,textResponse,conflictBody,revOf}=require('./harness.cjs');
const ok=(p,m=6000)=>jsonResponse({success:true,path:p,mod_time:m});
async function rename(app,name){app.click('docTitleBtn');await app.flush();app.document.getElementById('fsFileNameInput').value=name;app.click('btnFsConfirm');await app.flush();}
test('REVIEW: canceled queued save must not issue a POST after its session ends',async t=>{
 const app=await createApp();t.after(()=>app.close());const saves=deferRoute(app,'POST /api/save');
 app.append('A edit');app.ctrlS();await app.flush();
 app.emitSse('/docs/b.md');await app.flush();app.append('B edit');app.ctrlS();await app.flush();
 assert.equal(saves.count,1);app.click('actionNew');await app.flush();
 saves.at(0).resolve(ok('/docs/a.md'));await app.flush();
 assert.equal(app.saveCalls().length,1,'B write was queued, not yet sent, and must be canceled on New');
});
test('REVIEW: canceled queued rename must not issue a destructive POST',async t=>{
 const app=await createApp();t.after(()=>app.close());const saves=deferRoute(app,'POST /api/save');
 app.append('A edit');app.ctrlS();await app.flush();await rename(app,'a2.md');
 assert.equal(app.renameCalls().length,0);app.click('actionNew');await app.flush();
 saves.at(0).resolve(ok('/docs/a.md'));await app.flush();
 assert.equal(app.renameCalls().length,0,'obsolete rename should not move/delete the old document');
});
test('REVIEW: failed force-save must not disable conflict detection for later saves',async t=>{
 const app=await createApp();t.after(()=>app.close());const saves=deferRoute(app,'POST /api/save');
 app.append('edit');app.ctrlS();await app.flush();saves.at(0).resolve(jsonResponse(conflictBody('revision_mismatch'),409));await app.flush();
 assert.equal(app.lastSave().body.force,true,'the retry must be an explicit one-shot force');saves.at(1).resolve(textResponse('disk full',500));await app.flush();
 app.append('new edit');await app.advance(600);
 assert.equal(app.lastSave().body.force,false,'force consent must apply to one request only');
 assert.equal(app.lastSave().body.expected_revision,revOf('alpha'),'the baseline must survive a failed forced write');
});
test('REVIEW: conflict retry must be bounded to one retry',async t=>{
 const app=await createApp();t.after(()=>app.close());const saves=deferRoute(app,'POST /api/save');
 app.append('edit');app.ctrlS();await app.flush();saves.at(0).resolve(jsonResponse(conflictBody('revision_mismatch'),409));await app.flush();
 saves.at(1).resolve(jsonResponse(conflictBody('revision_mismatch'),409));await app.flush();
 assert.equal(app.saveCalls().length,2,'a second conflict must stop, not ask and retry again');
});
test('REVIEW: late rename error body must not show an alert in a new session',async t=>{
 const app=await createApp();t.after(()=>app.close());const body=deferred();
 app.routes['POST /api/rename']=()=>({ok:false,status:500,text:()=>body.promise});
 await rename(app,'a2.md');app.click('actionNew');await app.flush();body.resolve('old rename failure');await app.flush();
 assert.equal(app.alertMessages.length,0,'session must be rechecked after awaiting the error body');
});
