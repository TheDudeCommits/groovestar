import {chromium} from 'playwright-core';
import {mkdir,copyFile} from 'node:fs/promises';
const origin=process.env.GROOVESTAR_QA_URL??'http://127.0.0.1:5179';
await mkdir('output/playwright/video',{recursive:true});await mkdir('docs/qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const [name,path,ms]of [['blade','?demo=blade',20000],['rush','?demo=rush',14000],['dance','?dancetest',9000]]){
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:'output/playwright/video',size:{width:1280,height:720}}});
  const page=await context.newPage();const video=page.video();
  try{await page.goto(`${origin}/${path}`);await page.waitForSelector(name==='dance'?'.kinetic-dance-layer':'.kinetic-game');await page.waitForTimeout(ms);}finally{await context.close();}
  await video.saveAs(`docs/qa/${name}-demo.webm`);console.log(`${name} actual gameplay clip saved`);
 }
}finally{await browser.close();}
