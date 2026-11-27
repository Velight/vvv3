"""Portable first-run setup. Run: python3 scripts/setup.py [--llama]."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--llama', action='store_true', help='Download llama3.2:3b using installed Ollama')
args = parser.parse_args()
env_dir = root / '.venv'
if not env_dir.exists():
    venv.EnvBuilder(with_pip=True).create(env_dir)
python = env_dir / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root/'requirements.lock')], check=True)
if not (root/'.env').exists():
    editor, viewer = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    keys = {editor: {'user_id':'owner','role':'editor','clients':['*']}, viewer: {'user_id':'agent','role':'viewer','clients':['*']}}
    content = "API_KEYS_JSON='" + json.dumps(keys) + "'\nDATABASE_PATH=" + str(root/'data/krok.db') + "\nSEED_DEMO=true\nLLM_BASE_URL=http://127.0.0.1:11434/v1\nLLM_MODEL=llama3.2:3b\nLLM_TIMEOUT=120\nPUBLIC_HOSTS=\n"
    if not args.llama:
        content = content.replace('LLM_BASE_URL=http://127.0.0.1:11434/v1', 'LLM_BASE_URL=').replace('LLM_MODEL=llama3.2:3b', 'LLM_MODEL=')
    with open(root/'.env', 'x') as f:
        os.chmod(root/'.env', 0o600)
        f.write(content)
    with open(root/'ACCESS.txt', 'x') as f:
        os.chmod(root/'ACCESS.txt', 0o600)
        f.write('Редактор: '+editor+'\nАгент (просмотр): '+viewer+'\n')
if args.llama:
    ollama = shutil.which('ollama')
    if not ollama:
        raise SystemExit('Install and start Ollama from https://ollama.com, then rerun with --llama')
    subprocess.run([ollama, 'pull', 'llama3.2:3b'], check=True)
config = {'mcpServers': {'krok': {'command':str(python), 'args':[str(root/'scripts/mcp_stdio.py')]}}}
(root/'claude-desktop-mcp.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
print('Ready. Keys: ACCESS.txt. Run: '+str(python)+' scripts/laptop.py')
