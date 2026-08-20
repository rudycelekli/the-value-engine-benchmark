import subprocess, sys, pathlib, csv, math
ROOT = pathlib.Path(__file__).resolve().parents[1]

def test_cohens_kappa_perfect_agreement(tmp_path):
    sheet = tmp_path / "s.csv"
    with sheet.open("w", newline="") as f:
        w = csv.writer(f); w.writerow(["episode_id","judge","expert1"])
        for i in range(10): w.writerow([i, i % 3, i % 3])
    r = subprocess.run([sys.executable, "validation/agreement.py", str(sheet)],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0
    assert "kappa=1.0" in r.stdout.replace(" ", "")

def test_cohens_kappa_chance_level(tmp_path):
    sheet = tmp_path / "s.csv"
    with sheet.open("w", newline="") as f:
        w = csv.writer(f); w.writerow(["episode_id","judge","expert1"])
        rows = [(0,0),(1,1),(2,0),(3,1),(4,0),(5,1),(6,0),(7,1)]
        for i,(a,b) in enumerate(rows): w.writerow([i,a,b])
    r = subprocess.run([sys.executable, "validation/agreement.py", str(sheet)],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0  # near-zero kappa, no crash
