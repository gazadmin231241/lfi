export const fakeIsolationExecutable = (callsPath: string): string => `#!/bin/sh
printf '%s|%s\n' "$PWD" "$*" >> "${callsPath}"
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
[ "$#" -gt 0 ] && shift
exec "$@"
`;
