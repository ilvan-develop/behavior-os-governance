import os
import json
from collections import defaultdict

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
graph_path = os.path.join(repo_root, 'graphify-out', 'graph.json')

def load_graph():
    data = json.load(open(graph_path, encoding='utf-8'))
    nodes = {n['id']: n for n in data.get('nodes', [])}
    links = data.get('links', [])
    return nodes, links

def extract_subgraphs(nodes, links):
    # 1. Import Graph between packages and key modules
    import_edges = [l for l in links if l.get('relation') in ('imports', 'imports_from', 're_exports', 'dynamic_import')]
    
    # Package-to-package dependency summary
    pkg_deps = defaultdict(set)
    for e in import_edges:
        s = e['source']
        t = e['target']
        s_file = nodes.get(s, {}).get('source_file', '')
        t_file = nodes.get(t, {}).get('source_file', '')
        if s_file and t_file:
            s_pkg = s_file.split('/')[0] if not s_file.startswith('packages/') and not s_file.startswith('plugins/') else '/'.join(s_file.split('/')[:2])
            t_pkg = t_file.split('/')[0] if not t_file.startswith('packages/') and not t_file.startswith('plugins/') else '/'.join(t_file.split('/')[:2])
            if s_pkg != t_pkg:
                pkg_deps[s_pkg].add(t_pkg)
                
    # 2. Call Graph for critical paths
    call_edges = [l for l in links if l.get('relation') in ('calls', 'indirect_call', 'method')]
    
    return {
        "pkg_deps": {k: sorted(list(v)) for k, v in pkg_deps.items()},
        "total_import_edges": len(import_edges),
        "total_call_edges": len(call_edges)
    }

def run():
    nodes, links = load_graph()
    analysis = extract_subgraphs(nodes, links)
    with open(os.path.join(repo_root, 'architectural-pipeline', 'tree_analysis.json'), 'w', encoding='utf-8') as f:
        json.dump(analysis, f, indent=2)
    print("Tree analysis extracted.")

if __name__ == '__main__':
    run()
