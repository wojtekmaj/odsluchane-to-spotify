let verboseEnabled = false;

export function setVerboseLogging(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function logVerbose(message: string): void {
  if (!verboseEnabled) {
    return;
  }

  console.log(`[verbose] ${message}`);
}
