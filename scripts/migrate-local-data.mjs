/** Copy legacy local state without altering or deleting its source. */
import { existsSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'
const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
const sourcePath=process.argv[2]
if(!sourcePath)throw new Error('Usage: npm run migrate:local -- /path/to/legacy-server')
const sourceRoot=resolve(sourcePath)
const legacy=resolve(sourceRoot,'data'),destination=resolve(root,'data')
if(existsSync(resolve(legacy,'demotif.db'))){
  mkdirSync(destination,{recursive:true})
  const target=resolve(destination,'demotif.db')
  if(!existsSync(target)){
    const source=new DatabaseSync(resolve(legacy,'demotif.db'),{readOnly:true})
    try{await backup(source,target)}finally{source.close()}
    console.log('Copied legacy SQLite database; original retained.')
  }else console.log('Destination database exists; left unchanged.')
  for(const directory of ['media','examples'])if(existsSync(resolve(legacy,directory))){cpSync(resolve(legacy,directory),resolve(destination,directory),{recursive:true,force:false,errorOnExist:false})}
}
const env=resolve(root,'.env.local'),oldEnv=resolve(sourceRoot,'.env')
if(!existsSync(env)&&existsSync(oldEnv)){
  copyFileSync(oldEnv,env)
  // Relative legacy data paths now resolve against the workspace root.
  // Keep a user's absolute path selections intact.
  let content=readFileSync(env,'utf8')
  content=content.replace(/^DEMOTIF_ANALYSIS_PYTHON=.*$/m,'DEMOTIF_ANALYSIS_PYTHON=./analysis/.venv/bin/python')
  writeFileSync(env,content,{mode:0o600})
  console.log('Copied server environment to ignored .env.local; values not printed.')
}
