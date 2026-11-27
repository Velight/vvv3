"""Exercise the launcher's process decisions without binding the user's ports."""
import runpy
from pathlib import Path
import pytest


@pytest.mark.parametrize('flags', [[], ['--with-ollama']])
def test_missing_ollama_does_not_block_backend(monkeypatch, flags):
    import builtins
    import io
    original_open = builtins.open
    monkeypatch.setattr(builtins, "open", lambda file, *a, **kw: io.StringIO() if str(file).endswith("ollama.log") else original_open(file, *a, **kw))
    import dotenv
    import socket
    import subprocess
    import sys
    calls = []
    class Socket:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def connect_ex(self, address): return 1
    class Process:
        def __init__(self, args, **kwargs):
            calls.append((args, kwargs['env']))
            if args[0] == '/missing/ollama':
                raise FileNotFoundError('optional binary absent')
        def wait(self, **kwargs): return 0
        def terminate(self): pass
    monkeypatch.setattr(socket,'socket',Socket)
    monkeypatch.setattr(subprocess,'Popen',Process)
    monkeypatch.setattr(dotenv,'dotenv_values',lambda path: {})
    monkeypatch.setenv('LLM_BASE_URL','http://127.0.0.1:11434/v1')
    monkeypatch.setenv('LLM_MODEL','missing')
    monkeypatch.setattr(sys,'argv',['laptop.py','--ollama','/missing/ollama',*flags])
    runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/laptop.py'),run_name='__main__')
    server_args, server_env = calls[-1]
    assert 'uvicorn' in server_args
    assert server_env['LLM_BASE_URL'] == '' and server_env['LLM_MODEL'] == ''
    assert len(calls) == (2 if flags else 1)
