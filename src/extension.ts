import * as vscode from 'vscode';
// import { CatScratchEditorProvider } from './catScratchEditor';
import { ENViewerProvider } from './effectnodeViewer';

export function activate(context: vscode.ExtensionContext) {
	// Register our custom editor providers
	// context.subscriptions.push(CatScratchEditorProvider.register(context));
	context.subscriptions.push(ENViewerProvider.register(context));
}
