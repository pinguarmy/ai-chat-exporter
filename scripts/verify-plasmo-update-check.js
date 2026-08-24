#!/usr/bin/env node

const { isPlasmoUpdateCheckPatched } = require('./patch-plasmo-update-check')

if (!isPlasmoUpdateCheckPatched()) {
  console.error(
    'Plasmo update-check patch is missing from node_modules/plasmo/dist/index.js. ' +
      'PLASMO_NO_UPDATE_CHECK cannot take effect. Re-run npm ci, or update ' +
      'scripts/patch-plasmo-update-check.js if the Plasmo CLI shape changed.'
  )
  process.exit(1)
}
