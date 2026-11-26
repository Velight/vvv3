"""Local stdio bridge for Claude Desktop and MCP-compatible agents. No secrets in config."""
import asyncio
import json
import os
from pathlib import Path
from dotenv import dotenv_values
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

server = Server('krok-local-bridge')

async def main():
    config = dotenv_values(Path(__file__).resolve().parents[1] / '.env')
    key = os.getenv('KROK_API_KEY')
    if not key:
        keys = json.loads(config.get('API_KEYS_JSON', '{}'))
        key = next((k for k, v in keys.items() if v.get('role') == 'viewer'), None)
    if not key:
        raise RuntimeError('Set KROK_API_KEY to a viewer key')
    url = os.getenv('KROK_MCP_URL', 'http://127.0.0.1:8000/mcp/')
    async with streamablehttp_client(url, headers={'Authorization': 'Bearer '+key, 'X-Pinggy-No-Screen':'true'}) as (read, write, _):
        async with ClientSession(read, write) as remote:
            await remote.initialize()
            @server.list_tools()
            async def list_tools():
                return (await remote.list_tools()).tools
            @server.call_tool()
            async def call_tool(name, arguments):
                return await remote.call_tool(name, arguments)
            async with stdio_server() as (stdin, stdout):
                await server.run(stdin, stdout, server.create_initialization_options())

if __name__ == '__main__':
    asyncio.run(main())
