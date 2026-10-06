import {defineConfig} from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir:'./test/ui',workers:1,fullyParallel:false,timeout:1200000,retries:0,
  use:{baseURL:'http://127.0.0.1:4311',viewport:{width:1440,height:1050},actionTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node server/index.mjs --production',url:'http://127.0.0.1:4311/api/projects',timeout:120000,reuseExistingServer:false,env:{PATH:`${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,PORT:'4311',LUMEN_DATA_DIR:path.resolve(`.data/ui-tests-${Date.now()}`)}}
});
