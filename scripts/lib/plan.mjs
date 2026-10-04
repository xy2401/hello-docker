import { within } from './paths.mjs'
export { quoteArgument, formatCommand } from './shell.mjs'

export function makePlan(root, manifest, runId = 'preview') {
  if (!/^[a-z0-9-]{1,80}$/.test(runId)) throw new Error('Invalid run id')
  const name = `hello-docker-${manifest.id}-${runId}`
  const label = `io.hello-docker.run=${runId}`
  const buildImage = `hello-docker-${manifest.id}:${runId}`
  const step = (phase, args, env = {}) => ({ phase, program: 'docker', args, env })
  const prepare = [step('engine', ['version', '--format', '{{json .}}'])]
  for (const ref of new Set(Object.values(manifest.resolvedImages))) {
    prepare.push(step('pull', ['pull', '--platform', manifest.platform, ref]))
    prepare.push(step('image', ['image', 'inspect', ref]))
  }
  let execute
  let cleanup
  if (manifest.kind === 'compose') {
    prepare.push(step('compose-version', ['compose', 'version', '--short']))
    const prefix = ['compose', '--project-name', name, '--file', within(root, manifest.compose.file, { exists: true })]
    const env = manifest.resolvedImages
    prepare.push(step('compose-config', [...prefix, 'config', '--format', 'json'], env))
    execute = step('execute', [...prefix, 'up', '--pull', 'never', '--abort-on-container-exit', '--exit-code-from', manifest.compose.exitService], env)
    cleanup = [step('cleanup', [...prefix, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], env)]
  } else {
    let image = manifest.resolvedImages[manifest.imageRole]
    if (manifest.kind === 'build') {
      image = buildImage
      const args = ['build', '--platform', manifest.platform, '--network', 'none', '--pull=false', '--label', label, '--file', within(root, manifest.build.dockerfile, { exists: true }), '--tag', buildImage]
      for (const [arg, role] of Object.entries(manifest.build.args)) args.push('--build-arg', `${arg}=${manifest.resolvedImages[role]}`)
      args.push(within(root, manifest.build.context, { exists: true }))
      prepare.push(step('build', args), step('built-image', ['image', 'inspect', buildImage]))
    }
    const args = ['run', '--name', name, '--label', label, '--platform', manifest.platform, '--pull', 'never', '--network', 'none']
    for (const mount of manifest.mounts) args.push('--mount', `type=bind,source=${within(root, mount.source, { exists: true })},target=${mount.target},readonly`)
    args.push(image, ...manifest.command)
    execute = step('execute', args)
    // No --rm: final evidence can inspect the container before removing it.
    cleanup = [step('cleanup', ['rm', '--force', name])]
    if (manifest.kind === 'build') cleanup.push(step('cleanup', ['image', 'rm', buildImage]))
  }
  return { schemaVersion: 1, scenarioId: manifest.id, platform: manifest.platform, name, prepare, execute, cleanup }
}
