import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';

/**
 * Define the type of edits used in paw draw files.
 */
interface PawDrawEdit {
	readonly color: string;
	readonly stroke: ReadonlyArray<[number, number]>;
}

interface PawDrawDocumentDelegate {
	getFileData(): Promise<Uint8Array>;
}

/**
 * Define the document (the data model) used for paw draw files.
 */
class PawDrawDocument extends Disposable implements vscode.CustomDocument {

	static async create(
		uri: vscode.Uri,
		backupId: string | undefined,
		delegate: PawDrawDocumentDelegate,
	): Promise<PawDrawDocument | PromiseLike<PawDrawDocument>> {
		// If we have a backup, read that. Otherwise read the resource from the workspace
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const fileData = await PawDrawDocument.readFile(dataFile);
		return new PawDrawDocument(uri, fileData, delegate);
	}

	private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (uri.scheme === 'untitled') {
			return new Uint8Array();
		}
		return vscode.workspace.fs.readFile(uri);
	}

	private readonly _uri: vscode.Uri;

	private _documentData: Uint8Array;
	private _edits: Array<PawDrawEdit> = [];
	private _savedEdits: Array<PawDrawEdit> = [];

	private readonly _delegate: PawDrawDocumentDelegate;

	private constructor(
		uri: vscode.Uri,
		initialContent: Uint8Array,
		delegate: PawDrawDocumentDelegate
	) {
		super();
		this._uri = uri;
		this._documentData = initialContent;
		this._delegate = delegate;
	}

	public get uri() { return this._uri; }

	public get documentData(): Uint8Array { return this._documentData; }

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	/**
	 * Fired when the document is disposed of.
	 */
	public readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
		readonly content?: Uint8Array;
		readonly edits: readonly PawDrawEdit[];
	}>());
	/**
	 * Fired to notify webviews that the document has changed.
	 */
	public readonly onDidChangeContent = this._onDidChangeDocument.event;

	private readonly _onDidChange = this._register(new vscode.EventEmitter<{
		readonly label: string,
		undo(): void,
		redo(): void,
	}>());
	/**
	 * Fired to tell VS Code that an edit has occured in the document.
	 *
	 * This updates the document's dirty indicator.
	 */
	public readonly onDidChange = this._onDidChange.event;

	/**
	 * Called by VS Code when there are no more references to the document.
	 *
	 * This happens when all editors for it have been closed.
	 */
	dispose(): void {
		this._onDidDispose.fire();
		super.dispose();
	}

	/**
	 * Called when the user edits the document in a webview.
	 *
	 * This fires an event to notify VS Code that the document has been edited.
	 */
	makeEdit(edit: PawDrawEdit) {
		this._edits.push(edit);

		this._onDidChange.fire({
			label: 'Stroke',
			undo: async () => {
				this._edits.pop();
				this._onDidChangeDocument.fire({
					edits: this._edits,
				});
			},
			redo: async () => {
				this._edits.push(edit);
				this._onDidChangeDocument.fire({
					edits: this._edits,
				});
			}
		});
	}

	/**
	 * Called by VS Code when the user saves the document.
	 */
	async save(cancellation: vscode.CancellationToken): Promise<void> {
		await this.saveAs(this.uri, cancellation);
		this._savedEdits = Array.from(this._edits);
	}

	/**
	 * Called by VS Code when the user saves the document to a new location.
	 */
	async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
		const fileData = await this._delegate.getFileData();
		if (cancellation.isCancellationRequested) {
			return;
		}
		await vscode.workspace.fs.writeFile(targetResource, fileData);
	}

	/**
	 * Called by VS Code when the user calls `revert` on a document.
	 */
	async revert(_cancellation: vscode.CancellationToken): Promise<void> {
		const diskContent = await PawDrawDocument.readFile(this.uri);
		this._documentData = diskContent;
		this._edits = this._savedEdits;
		this._onDidChangeDocument.fire({
			content: diskContent,
			edits: this._edits,
		});
	}

	/**
	 * Called by VS Code to backup the edited document.
	 *
	 * These backups are used to implement hot exit.
	 */
	async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
		await this.saveAs(destination, cancellation);

		return {
			id: destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(destination);
				} catch {
					// noop
				}
			}
		};
	}
}

/**
 * Provider for paw draw editors.
 *
 * Paw draw editors are used for `.pawDraw` files, which are just `.png` files with a different file extension.
 *
 * This provider demonstrates:
 *
 * - How to implement a custom editor for binary files.
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Communication between VS Code and the custom editor.
 * - Using CustomDocuments to store information that is shared between multiple custom editors.
 * - Implementing save, undo, redo, and revert.
 * - Backing up a custom editor.
 */
export class ENViewerProvider implements vscode.CustomEditorProvider<PawDrawDocument> {

	private static newPawDrawFileId = 1;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		// vscode.commands.registerCommand('effectnode.viewer.new', () => {
		// 	const workspaceFolders = vscode.workspace.workspaceFolders;
		// 	if (!workspaceFolders) {
		// 		vscode.window.showErrorMessage("Creating new Paw Draw files currently requires opening a workspace");
		// 		return;
		// 	}

		// 	const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-${ENViewerProvider.newPawDrawFileId++}.pawdraw`)
		// 		.with({ scheme: 'untitled' });

		// 	vscode.commands.executeCommand('vscode.openWith', uri, ENViewerProvider.viewType);
		// });

		return vscode.window.registerCustomEditorProvider(
			ENViewerProvider.viewType,
			new ENViewerProvider(context),
			{
				// For this demo extension, we enable `retainContextWhenHidden` which keeps the
				// webview alive even when it is not visible. You should avoid using this setting
				// unless is absolutely required as it does have memory overhead.
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			});
	}

	private static readonly viewType = 'effectnode.viewer';

	/**
	 * Tracks all known webviews
	 */
	private readonly webviews = new WebviewCollection();

	constructor(
		private readonly _context: vscode.ExtensionContext
	) { }

	//#region CustomEditorProvider

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_token: vscode.CancellationToken
	): Promise<PawDrawDocument> {
		const document: PawDrawDocument = await PawDrawDocument.create(uri, openContext.backupId, {
			getFileData: async () => {
				const webviewsForDocument = Array.from(this.webviews.get(document.uri));
				if (!webviewsForDocument.length) {
					throw new Error('Could not find webview to save for');
				}
				const panel = webviewsForDocument[0];
				const response = await this.postMessageWithResponse<number[]>(panel, 'getFileData', {});
				return new Uint8Array(response);
			}
		});

		const listeners: vscode.Disposable[] = [];

		listeners.push(document.onDidChange(e => {
			// Tell VS Code that the document has been edited by the use.
			this._onDidChangeCustomDocument.fire({
				document,
				...e,
			});
		}));

		listeners.push(document.onDidChangeContent(e => {
			// Update all webviews when the document changes
			for (const webviewPanel of this.webviews.get(document.uri)) {
				this.postMessage(webviewPanel, 'update', {
					edits: e.edits,
					content: e.content,
				});
			}
		}));

		document.onDidDispose(() => disposeAll(listeners));

		return document;
	}

	async resolveCustomEditor(
		document: PawDrawDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);

		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true
		};

		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e, webviewPanel.webview));


		//
		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type === 'setActorIDX') {
				this._context.workspaceState.update('actorIDX', e.idx)
			}
		});



		// Wait for the webview to be properly ready before we init
		// webviewPanel.webview.onDidReceiveMessage(e => {
		// 	if (e.type === 'ready') {
		// 		if (document.uri.scheme === 'untitled') {
		// 			this.postMessage(webviewPanel, 'init', {
		// 				untitled: true
		// 			});
		// 			console.log('bad url')
		// 		} else {
		// 			this.postMessage(webviewPanel, 'init', {
		// 				value: document.documentData
		// 			});
		// 			console.log('good url')
		// 		}
		// 	}
		// });
	}

	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<PawDrawDocument>>();
	public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

	public saveCustomDocument(document: PawDrawDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.save(cancellation);
	}

	public saveCustomDocumentAs(document: PawDrawDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.saveAs(destination, cancellation);
	}

	public revertCustomDocument(document: PawDrawDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.revert(cancellation);
	}

	public backupCustomDocument(document: PawDrawDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
		return document.backup(context.destination, cancellation);
	}

	//#endregion

	/**
	 * Get the static HTML used for in our editor's webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview, document: PawDrawDocument): string {
		// Local path to script and css for the webview
		// const scriptUri = webview.asWebviewUri(vscode.Uri.file(
		// 	path.join(this._context.extensionPath, 'media', 'pawDraw.js')
		// ));

		const scriptAppUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'gui-out', 'app.js')
		));

		const styleResetUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'reset.css')
		));

		const styleFullUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'full.css')
		));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'vscode.css')
		));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'pawDraw.css')
		));

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		const HDR = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'courtyard_night_1k.hdr')
		)).toString();

		const SELECTED = webview.asWebviewUri(document.uri).toString();

		const ACTOR = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'chars', 'summer.fbx')
		)).toString();

		const ACTORS = [
			{
				name: 'eric-glb',
				displayName: 'eric',
				type: 'glb',
				url: webview.asWebviewUri(vscode.Uri.file(
					path.join(this._context.extensionPath, 'media', 'chars', 'eric.glb')
				)).toString()
			},

			{
				name: 'swat-glb',
				displayName: 'swat',
				type: 'glb',
				url: webview.asWebviewUri(vscode.Uri.file(
					path.join(this._context.extensionPath, 'media', 'chars', 'swat.glb')
				)).toString()
			},

			{
				name: 'matrix-glb',
				displayName: 'matrix',
				type: 'glb',
				url: webview.asWebviewUri(vscode.Uri.file(
					path.join(this._context.extensionPath, 'media', 'chars', 'matrix.glb')
				)).toString()
			},

			{
				name: 'neo-glb',
				displayName: 'neo',
				type: 'glb',
				url: webview.asWebviewUri(vscode.Uri.file(
					path.join(this._context.extensionPath, 'media', 'chars', 'neo.glb')
				)).toString()
			},
			// {
			// 	name: 'neo-fbx',
			// 	displayName: 'neo-fbx',
			// 	type: 'fbx',
			// 	url: webview.asWebviewUri(vscode.Uri.file(
			// 		path.join(this._context.extensionPath, 'media', 'chars', 'neo.fbx')
			// 	)).toString()
			// },
		]

		if (vscode.workspace && vscode.workspace.workspaceFolders) {
			const fs = require('fs');
			let newAdd: any = []
			vscode.workspace.workspaceFolders.forEach(e => {
				const actorsFolder = path.join(e.uri.path, './actors');
				if (fs.existsSync(actorsFolder)) {
					fs.readdirSync(actorsFolder).forEach((file: 'string') => {
						let newActor = {
							name: `${file}`,
							displayName: `${file}`,
							isFolder: true,
							isNew: true,
							type: `${path.extname(file).replace('.', '')}`,
							url: webview.asWebviewUri(vscode.Uri.file(
								path.join(actorsFolder, file)
							)).toString()
						}
						newAdd.unshift(newActor);
						// let info = fs.statSync(path.join(actorsFolder, file))
						// console.log('workspace folder', JSON.stringify(info))
					})
				}
			})

			newAdd.sort((a: any, b: any) => {
				if (a.name > b.name) {
					return 1
				}
				if (a.name < b.name) {
					return -1
				}
				if (a.name === b.name) {
					return 0
				}
			});

			//
			newAdd = newAdd.filter((e: any) => {
				return e.name !== '.DS_Store'
			})
			//
			ACTORS.unshift(...newAdd)

		}

		// // console.log(scanFolder)
		// const fs = require('fs');
		// let scanFolder = path.join(document.uri.path, '../actors');
		// if (fs.existsSync(scanFolder)) {
		// 	// webview.asWebviewUri(document.uri).toString()
		// 	fs.readdirSync(scanFolder).forEach((file: any) => {
		// 		console.log('', file);
		// 	});
		// }

		const actorIDX = this._context.workspaceState.get('actorIDX', 0)

		const isActionFolder = (SELECTED.indexOf('/action/') !== -1) || SELECTED.indexOf('/actions/') !== -1 || SELECTED.indexOf('/moves/') !== -1
		let MODE = isActionFolder ? 'ACTION_PREVIEW' : 'MODEL_PREVIEW'

		return /* html */`
			<!DOCTYPE html >
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src ${webview.cspSource} blob:; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />
				<link href="${styleFullUri}" rel="stylesheet" />

				<title>Paw Draw</title>
			</head>
			<body>
				<div id="root"></div>

				<!--
				<div class="drawing-canvas"></div>

				<div class="drawing-controls">
					<button data-color="black" class="black active" title="Black"></button>
					<button data-color="white" class="white" title="White"></button>
					<button data-color="red" class="red" title="Red"></button>
					<button data-color="green" class="green" title="Green"></button>
					<button data-color="blue" class="blue" title="Blue"></button>
				</div>

				<script nonce="${nonce}" src="$dd{scriptUri}"></script>
				-->

				<script nonce="${nonce}">
					window.VIEWER = {
						ACTOR_IDX: ${actorIDX},
						MODE: "${MODE}",
						ACTORS: ${JSON.stringify(ACTORS)},
						//ACTOR: "${ACTOR}",
						HDR: "${HDR}",
						SELECTED: "${SELECTED}"
					};
				</script>

				<script nonce="${nonce}" src="${scriptAppUri}"></script>
			</body>
			</html>`;
	}

	private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
	}

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: PawDrawDocument, message: any, webview: vscode.Webview) {
		if (message.type === 'reload') {
			webview.html = this.getHtmlForWebview(webview, document);
		}

		// if (message.type === 'loadGLB') {
		// 	const hdr = webview.asWebviewUri(vscode.Uri.file(
		// 		path.join(this._context.extensionPath, 'media', 'courtyard_night_1k.hdr')
		// 	)).toString();

		// 	const url = webview.asWebviewUri(document.uri).toString();
		// 	webview.postMessage({ type: 'loadGLB', hdr, url: url, r: Math.random() });

		// 	// vscode.workspace.fs.readFile(document.uri)
		// 	// 	.then((arr) => {
		// 	// 		console.log('extension-done-loading', 'loadGLB', arr.length)
		// 	// 		webview.postMessage({ type: 'loadGLB', data: arr, r: Math.random() });
		// 	// 	})
		// 	// 	console.log('extension-start-loading', 'loadGLB')
		// }
		// switch (message.type) {
		// 	case 'stroke':
		// 		document.makeEdit(message as PawDrawEdit);
		// 		return;

		// 	case 'response':
		// 		{
		// 			const callback = this._callbacks.get(message.requestId);
		// 			callback?.(message.body);
		// 			return;
		// 		}
		// }
	}
}

/**
 * Tracks all webviews.
 */
class WebviewCollection {

	private readonly _webviews = new Set<{
		readonly resource: string;
		readonly webviewPanel: vscode.WebviewPanel;
	}>();

	/**
	 * Get all known webviews for a given uri.
	 */
	public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
		const key = uri.toString();
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				yield entry.webviewPanel;
			}
		}
	}

	/**
	 * Add a new webview to the collection.
	 */
	public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
		const entry = { resource: uri.toString(), webviewPanel };
		this._webviews.add(entry);

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(entry);
		});
	}
}