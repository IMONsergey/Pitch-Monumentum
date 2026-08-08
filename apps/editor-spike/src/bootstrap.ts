import { installPitchRichTextUI } from "./rich-text-ui.js";
import { installPitchAutoLayoutUI } from "./auto-layout-ui.js";
import { installPitchProEditorUI } from "./pro-editor-ui.js";
import { installPitchHistoryShortcuts } from "./history-shortcuts.js";
import { installPitchInspectorUI } from "./inspector-ui.js";
import "./client.js";

installPitchRichTextUI();
installPitchAutoLayoutUI();
installPitchProEditorUI();
installPitchHistoryShortcuts();
installPitchInspectorUI();
