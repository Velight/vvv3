"""Run the app, local Ollama and an optional Pinggy tunnel until Ctrl+C."""
import argparse
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from dotenv import dotenv_values

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--public', action='store_true', help='Expose through the user-approved Pinggy service')
parser.add_argument('--ollama', default=os.getenv('OLLAMA_BIN', 'ollama'))
parser.add_argument('--models', default=os.getenv('OLLAMA_MODELS'))
args = parser.parse_args()
env = {**os.environ, **{k: v for k, v in dotenv_values(root / '.env').items() if v is not None}}
children = []
logs = root / 'data' / 'logs'
logs.mkdir(parents=True, exist_ok=True)


def occupied(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


try:
    if occupied(8000):
        sys.exit('Сервер уже запущен: http://127.0.0.1:8000. Сначала остановите прежний запуск.')
    if not occupied(11434):
        ollama_env = {**env, 'OLLAMA_HOST': '127.0.0.1:11434', 'OLLAMA_NO_CLOUD': '1', 'OLLAMA_CONTEXT_LENGTH': '8192', 'OLLAMA_NUM_PARALLEL': '1'}
        if args.models:
            ollama_env['OLLAMA_MODELS'] = args.models
        children.append(subprocess.Popen([args.ollama, 'serve'], env=ollama_env, stdout=open(logs/'ollama.log', 'a'), stderr=subprocess.STDOUT))
    if args.public:
        tunnel = subprocess.Popen(['ssh', '-F', '/dev/null', '-p', '443', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30',
            '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile='+str(root/'data'/'pinggy-known-hosts'),
            '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'PubkeyAuthentication=no',
            '-R0:127.0.0.1:8000', 'free@free.pinggy.io'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        children.append(tunnel)
        for line in tunnel.stdout:
            match = re.search(r'https://([a-zA-Z0-9.-]+(?:pinggy\.net|pinggy-free\.link))', line)
            if match:
                host = match[1]
                env['PUBLIC_HOSTS'] = host
                (root/'data'/'public-url.txt').write_text('https://'+host+'\n')
                print('Сайт: https://'+host, flush=True)
                print('MCP: https://'+host+'/mcp/', flush=True)
                print('Бесплатный туннель Pinggy действует 60 минут.', flush=True)
                break
        else:
            raise RuntimeError('Pinggy не создал адрес; проверьте сетевое соединение.')
    server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', '8000'], cwd=root, env=env)
    children.append(server)
    print('Локально: http://127.0.0.1:8000 — остановка: Ctrl+C', flush=True)
    server.wait()
except KeyboardInterrupt:
    pass
finally:
    for child in reversed(children):
        child.terminate()
    for child in children:
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
