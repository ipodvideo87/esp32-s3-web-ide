import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

interface CodeMirrorEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

export default function CodeMirrorEditor({ value, onChange, readOnly = false }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        cpp(),
        oneDark,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of(update => {
          if (update.docChanged && onChangeRef.current) onChangeRef.current(update.state.doc.toString());
        }),
        EditorState.tabSize.of(2),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    editorRef.current = view;
    return () => { view.destroy(); };
  }, [readOnly]);

  useEffect(() => {
    if (!editorRef.current) return;
    const currentDoc = editorRef.current.state.doc.toString();
    if (currentDoc === value) return;
    editorRef.current.dispatch({ changes: { from: 0, to: currentDoc.length, insert: value } });
  }, [value]);

  return <div ref={containerRef} className="w-full h-full cm-editor" />;
}
