export function quoteArgument(value, shell = 'bash') {
  return shell === 'powershell' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`
}

export function formatCommand(step, shell = 'bash') {
  const command = [step.program, ...step.args].map(value => quoteArgument(value, shell)).join(' ')
  const env = Object.entries(step.env || {}).map(([key, value]) => shell === 'powershell' ? `$env:${key} = ${quoteArgument(value, shell)}; ` : `${key}=${quoteArgument(value, shell)} `).join('')
  return `${env}${shell === 'powershell' ? '& ' : ''}${command}`
}
