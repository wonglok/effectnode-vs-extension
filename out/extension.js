"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
// import { CatScratchEditorProvider } from './catScratchEditor';
const effectnodeViewer_1 = require("./effectnodeViewer");
function activate(context) {
    // Register our custom editor providers
    // context.subscriptions.push(CatScratchEditorProvider.register(context));
    context.subscriptions.push(effectnodeViewer_1.ENViewerProvider.register(context));
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map