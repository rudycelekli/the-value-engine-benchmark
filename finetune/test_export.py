import subprocess, sys, pathlib, json, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]

def test_export_emits_prompt_completion_reward(tmp_path):
    out = tmp_path / "sft.jsonl"
    r = subprocess.run([sys.executable, "finetune/export_sft.py", "--out", str(out), "--limit", "5"],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    rows = [json.loads(l) for l in out.open()]
    assert rows and all({"prompt","completion","reward"} <= set(x) for x in rows)
