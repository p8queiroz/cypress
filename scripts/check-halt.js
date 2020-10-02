/* eslint-disable no-console */
const execa = require('execa')
const fs = require('fs')
const got = require('got')
const argv = require('minimist')(process.argv.slice(2))

const changedPackages = require('./changed-packages')

const pack = argv._[0]

const containsBinary = (changes) => {
  return !!changes.find((name) => name === 'cypress' || name.includes('@packages'))
}

const verifySSH = async () => {
  await execa('mkdir', ['-p', '~/.ssh'])
  fs.writeFileSync('~/.ssh/known_hosts', 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==')
}

const getPRBase = async () => {
  try {
    const pr = process.env.CIRCLE_PULL_REQUEST.match(/\d+/)[0]

    const response = await got.get(`https://api.github.com/repos/cypress-io/cypress/pulls/${pr}`, { responseType: 'json' })

    return response.body.base.ref
  } catch (e) {
    return null
  }
}

const findBase = async (currentBranch) => {
  // if we know there is a PR, find it's base
  if (process.env.CIRCLE_PULL_REQUEST) {
    const prBase = await getPRBase()

    if (prBase) {
      if (prBase !== 'develop') {
        // pull down pr base branch
        await execa('git', ['fetch', 'origin', `${prBase}:${prBase}`])
      }

      return prBase
    }
  }

  // we don't know exactly what to compare to here without PR info
  // so we check if the current state of develop is in the history of our branch
  // and if it is we base off develop, if not then our branch is behind develop
  // so we default to master as the most likely option

  const { stdout: branchesFromDevelop } = await execa('git', ['branch', '--contains', 'develop'])
  const isDevelop = branchesFromDevelop.includes(currentBranch)

  if (!isDevelop) {
    // make sure we have master pulled down
    await execa('git', ['fetch', 'origin', 'master:master'])
  }

  return isDevelop ? 'develop' : 'master'
}

const main = async () => {
  verifySSH()

  const { stdout: currentBranch } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'])

  if (currentBranch === 'develop' || currentBranch === 'master') {
    console.log(`Currently on ${currentBranch} - all tests run`)
    process.exit(0)
  }

  const base = await findBase(currentBranch)
  const changed = await changedPackages(base)

  if (containsBinary(changed)) {
    console.log(`Binary was changed - all tests run`)
    process.exit(0)
  }

  if (pack) {
    if (changed.includes(pack)) {
      console.log(`${pack} was changed, tests run`)
      process.exit(0)
    }

    console.log(`${pack} and the binary are unchanged, so skip tests`)
    process.exit(1)
  }

  console.log(`The binary is unchanged, so skip tests`)
  process.exit(1)
}

main()
