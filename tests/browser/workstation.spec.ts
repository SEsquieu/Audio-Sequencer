import { test, expect } from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');});
test('compose, transform, undo, autosave and export round trip',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('textbox',{name:'Project title'}).fill('Regression session');
 const cell=page.getByRole('button',{name:'C4, step 1',exact:true});
 await cell.focus();await cell.press('Enter');await expect(cell).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();
 await expect(page.getByRole('region',{name:'Pattern tools'})).toContainText('Pattern 2');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByRole('region',{name:'Pattern tools'})).toContainText('Pattern 1');
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.getByRole('button',{name:'Expression',exact:true}).click();
 await expect(page.getByLabel('Note 60 chance')).toHaveValue('1');
 await page.getByLabel('Note 60 repeats').fill('3');
 await expect(page.getByRole('status',{name:'Autosave'})).toContainText('Saved locally');
 await page.reload();await expect(page.getByRole('textbox',{name:'Project title'})).toHaveValue('Regression session');
 await expect(cell).toHaveAttribute('aria-pressed','true');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save song to file'}).click();
 expect((await download).suggestedFilename()).toContain('Regression-session');
 expect(errors).toEqual([]);
});
test('touch entry, rack synthesis, user patches and mix survive reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const cell=page.getByRole('button',{name:'C4, step 1',exact:true});
 await cell.click();await expect(cell).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Sound',exact:true}).click();
 await page.getByLabel('Osc B semitones').fill('12');
 await page.getByLabel('LFO destination').selectOption('pan');
 await page.getByLabel('LFO depth').fill('0.3');
 await page.getByRole('button',{name:'♪ Audition sound'}).click();
 await page.getByText('My patches (0)',{exact:true}).click();
 await page.getByRole('textbox',{name:'Patch name'}).fill('Octave shimmer');
 await page.getByRole('button',{name:'Save patch',exact:true}).click();
 await expect(page.getByRole('button',{name:'Octave shimmer',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Mix',exact:true}).click();
 await page.getByLabel('Lead pan',{exact:true}).fill('-0.5');
 await page.getByRole('button',{name:'Solo',exact:true}).first().click();
 await expect(page.getByRole('button',{name:'Solo',exact:true}).first()).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 await page.waitForTimeout(500);
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(page.getByRole('status',{name:'Autosave'})).toContainText('Saved locally');
 await page.reload();
 await page.getByRole('button',{name:'Sound',exact:true}).click();
 await expect(page.getByLabel('Osc B semitones')).toHaveValue('12');
 await expect(page.getByLabel('LFO destination')).toHaveValue('pan');
 await page.getByRole('button',{name:'Mix',exact:true}).click();
 await expect(page.getByLabel('Lead pan',{exact:true})).toHaveValue('-0.5');
 expect(errors).toEqual([]);
});
test('arrangement, append history, drum editing and invalid import safety',async({page})=>{
 await page.getByRole('button',{name:'Arrange',exact:true}).click();
 await expect(page.getByRole('region',{name:'Timeline',exact:true})).toBeVisible();
 // Add bars then undo an append transaction, the original branch regression.
 await page.getByRole('button',{name:'Add 4 bars',exact:true}).click();
 await expect(page.getByLabel('Selected bar').locator('option')).toHaveCount(12);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByLabel('Selected bar').locator('option')).toHaveCount(8);
 await page.getByLabel('Selected track',{exact:true}).selectOption('2');
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('button',{name:'kick, step 1',exact:true}).click();
 await expect(page.getByRole('button',{name:'kick, step 1',exact:true})).toHaveAttribute('aria-pressed','true');
 page.once('dialog',d=>d.accept());
 await page.locator('input[type=file]').setInputFiles({name:'broken.frog',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({tempo:0,tracks:[]}))});
 await expect(page.getByRole('button',{name:'kick, step 1',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('all workspaces fit viewport without page overflow or console crashes',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const mode of ['Compose','Arrange','Sound','Mix']) {
  await page.getByRole('button',{name:mode,exact:true}).click();
  await expect(page.locator('header')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`${mode}.png`),fullPage:true});
 }
 expect(errors).toEqual([]);
});
