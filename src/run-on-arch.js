const core = require('@actions/core')
const fs = require('fs');
const path = require('path')
const YAML = require('yaml');
const shlex = require('shlex');
const { exec } = require('@actions/exec')

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

  core.startGroup('Prepare docker');
  console.log('Configuring Docker for multi-architecture support')
  await exec(
    path.join(__dirname, 'run-on-arch.sh'),
    [ image, ...dockerRunArgs ],
    { env },
  );
  core.endGroup();
  
  let runs = [];
  if (core.getInput('run')) {
    const script = core.getInput('run');
    const firstLine = script.split('\n')[0];
    runs.push({ name: firstLine, run: script });
  } else if (core.getInput('multipleRun')) {
    const parsed = YAML.parse(core.getInput('multipleRun'));
    if (!Array.isArray(parsed)) {
      throw new Error('run-on-arch: multipleRun must be a list of {name, run} objects');
    }
    for (const i in parsed) {
      const item = parsed[i];
      if (typeof item !== 'object') {
        throw new Error('run-on-arch: multipleRun must be a list of {name, run} objects');
      }
      if (!item.run) {
        throw new Error('run-on-arch: multipleRun objects must have run key');
      }
      if (!item.name) {
        item.name = item.run.split('\n')[0];
      }
      runs.push(item);
    }
  }

  for (const run of runs) {
    core.startGroup(run.name);
    // Write container commands to a script file for running
    const commands = [
      `#!${shell}`, 'set -eu;', run.run,
    ].join('\n');
    fs.writeFileSync(
      path.join(__dirname, 'run-on-arch-commands.sh'),
      commands,
    );

    await exec(
      "docker",
      ["exec", "-t", "worker", shell, path.join(__dirname, 'run-on-arch-commands.sh')],
      { env },
    );
    core.endGroup();
  }
  
}

main().catch(err => {
  core.setFailed(err.message)
})
