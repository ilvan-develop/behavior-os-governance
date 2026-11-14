import os
import json
import re
from collections import defaultdict, Counter

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

def analyze_packages():
    packages_dir = os.path.join(repo_root, 'packages')
    plugins_dir = os.path.join(repo_root, 'plugins')
    results = {}
    
    # packages
    for pkg in os.listdir(packages_dir):
        pkg_path = os.path.join(packages_dir, pkg)
        if os.path.isdir(pkg_path) and os.path.exists(os.path.join(pkg_path, 'package.json')):
            pj = json.load(open(os.path.join(pkg_path, 'package.json'), encoding='utf-8'))
            results[f"package:{pkg}"] = {
                "name": pj.get("name"),
                "version": pj.get("version"),
                "dependencies": pj.get("dependencies", {}),
                "devDependencies": pj.get("devDependencies", {}),
                "path": os.path.relpath(pkg_path, repo_root).replace('\\', '/')
            }
            
    # plugins
    for plg in os.listdir(plugins_dir):
        plg_path = os.path.join(plugins_dir, plg)
        if os.path.isdir(plg_path) and os.path.exists(os.path.join(plg_path, 'package.json')):
            pj = json.load(open(os.path.join(plg_path, 'package.json'), encoding='utf-8'))
            results[f"plugin:{plg}"] = {
                "name": pj.get("name"),
                "version": pj.get("version"),
                "dependencies": pj.get("dependencies", {}),
                "devDependencies": pj.get("devDependencies", {}),
                "path": os.path.relpath(plg_path, repo_root).replace('\\', '/')
            }
    return results

def count_loc(dir_path, extensions=('.ts', '.js', '.mjs', '.json', '.yaml', '.yml', '.md')):
    counts = defaultdict(lambda: {"files": 0, "lines": 0})
    for root, dirs, files in os.walk(dir_path):
        # skip node_modules, dist, .git, etc.
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', '.git', '.turbo', 'coverage')]
        for f in files:
            ext = os.path.splitext(f)[1]
            if ext in extensions:
                p = os.path.join(root, f)
                try:
                    with open(p, 'r', encoding='utf-8', errors='ignore') as fp:
                        lines = sum(1 for _ in fp)
                    counts[ext]["files"] += 1
                    counts[ext]["lines"] += lines
                except Exception:
                    pass
    return counts

def analyze_graph():
    graph_path = os.path.join(repo_root, 'graphify-out', 'graph.json')
    if not os.path.exists(graph_path):
        return {}
    data = json.load(open(graph_path, encoding='utf-8'))
    nodes = data.get('nodes', [])
    links = data.get('links', [])
    
    # centralities and degree
    deg = Counter()
    in_deg = Counter()
    out_deg = Counter()
    rel_counts = Counter()
    
    for l in links:
        s = l.get('source')
        t = l.get('target')
        r = l.get('relation')
        deg[s] += 1
        deg[t] += 1
        out_deg[s] += 1
        in_deg[t] += 1
        rel_counts[r] += 1
        
    top_deg = deg.most_common(20)
    top_in = in_deg.most_common(15)
    top_out = out_deg.most_common(15)
    
    return {
        "node_count": len(nodes),
        "edge_count": len(links),
        "relation_counts": dict(rel_counts),
        "top_degree": top_deg,
        "top_in_degree": top_in,
        "top_out_degree": top_out
    }

def run():
    pkgs = analyze_packages()
    loc = count_loc(repo_root)
    graph = analyze_graph()
    
    out = {
        "packages": pkgs,
        "loc": {k: dict(v) for k, v in loc.items()},
        "graph_stats": graph
    }
    
    with open(os.path.join(repo_root, 'architectural-pipeline', 'system_metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)
    print("Metrics extracted successfully.")

if __name__ == '__main__':
    run()
