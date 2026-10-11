# -*- coding: utf-8 -*-
import json
import os

config_path = 'C:/www/behavior-os/opencode.json'
with open(config_path, 'r', encoding='utf-8') as f:
    config = json.load(f)

config['mcpServers']['behavioros']['args'] = ['C:/www/behavior-os/packages/mcp-server/dist/mcp-server/src/server.js'];

with open(config_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2)

print('Updated MCP server path to native Windows format')
print('New args:', config['mcpServers']['behavioros']['args'])
