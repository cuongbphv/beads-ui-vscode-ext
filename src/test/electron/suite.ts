/**
 * Activation smoke test. Runs inside a real Extension Development Host against
 * this repo's own `.beads` database, so it exercises the whole chain:
 * activate → BdService → bd → store → tree.
 *
 * Deliberately runner-free: `@vscode/test-electron` only requires a module that
 * exports `run()` and rejects on failure, and a mocha dependency for four
 * assertions is not worth the supply chain.
 */
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'cuongbphv.beads-ui';

async function waitFor(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} is not installed in the test host`);

  await extension.activate();
  assert.equal(extension.isActive, true, 'Extension failed to activate');

  // The workspace under test is this repo, which has a .beads directory, so
  // every command must be registered.
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'beadsUi.openDashboard',
    'beadsUi.refresh',
    'beadsUi.showOutput',
    'beadsUi.setStatus',
    'beadsUi.setPriority',
    'beadsUi.setAssignee',
    'beadsUi.claim',
    'beadsUi.closeBead',
    'beadsUi.copyId',
  ]) {
    assert.ok(commands.includes(command), `Command not registered: ${command}`);
  }

  // Refresh has to complete without throwing — that is the real bd round trip.
  await vscode.commands.executeCommand('beadsUi.refresh');

  // The dashboard must open and stay open; a CSP or bundle error would kill it.
  await vscode.commands.executeCommand('beadsUi.openDashboard');
  await waitFor('dashboard panel to be created', () =>
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label === 'Beads Dashboard'),
    ),
  );

  console.log('smoke test: activation, commands, refresh and dashboard all OK');
}
