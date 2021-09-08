const core = require('@actions/core')
const fs = require('fs');
const path = require('path')
const YAML = require('yaml');
const shlex = require('shlex');
const { exec } = require('@actions/exec')

function slug(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('run-on-arch supports only Linux')
  }

  const image = core.getInput('image', { required: true });

  // Write setup commands to a script file for sourcing
  let setup = core.getInput('setup');
  fs.writeFileSync(
    path.join(__dirname, 'run-on-arch-setup.sh'),
    setup,
  );

  // If no shell provided, default to sh for alpine, bash for others
  let shell = core.getInput('shell');
  if (!shell) {
    if (/alpine/.test(image)) {
      shell = '/bin/sh';
    } else {
      shell = '/bin/bash';
    }
  }

  // Write container commands to a script file for running
  const commands = [
    `#!${shell}`, 'set -eu;', core.getInput('run', { required: true }),
  ].join('\n');
  fs.writeFileSync(
    path.join(__dirname, 'run-on-arch-commands.sh'),
    commands,
  );

  // Parse dockerRunArgs into an array with shlex
  const dockerRunArgs = shlex.split(core.getInput('dockerRunArgs'));

  const githubToken = core.getInput('githubToken');

  // Copy environment variables from parent process
  const env = { ...process.env };

  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
  }

  // Parse YAML and for environment variables.
  // They are imported to the container via passing `-e VARNAME` to
  // docker run.
  const envYAML = core.getInput('env');
  if (envYAML) {
    const mapping = YAML.parse(envYAML)
    if (typeof mapping !== 'object' || mapping instanceof Array) {
      throw new Error(`run-on-arch: env must be a flat mapping of key/value pairs.`);
    }
    Object.entries(mapping).forEach(([key, value]) => {
      if (typeof value === 'object') {
        // Nested YAML is invalid
        throw new Error(`run-on-arch: env ${key} value must be flat.`);
      }
      env[key] = value;
      dockerRunArgs.push(`-e${key}`);
    });
  }

  console.log('Configuring Docker for multi-architecture support')
  await exec(
    path.join(__dirname, 'run-on-arch.sh'),
    [ image, ...dockerRunArgs ],
    { env },
  );
}

main().catch(err => {
  core.setFailed(err.message)
})
