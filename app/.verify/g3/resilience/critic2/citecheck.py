# For each "(p.N)" citation in the wiki, check that a number appearing in the same sentence occurs on page N of the PDF.
import json, re, subprocess, sys
pdf, wiki = sys.argv[1], json.load(open(sys.argv[2]))
txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout.split("\f")
norm = lambda s: re.sub(r"[\s,]", "", s)
pages = [norm(p) for p in txt]
num = re.compile(r"\d+(?:[.,]\d+)*")
res = {"numericCites": 0, "onCitedPage": 0, "otherPage": 0, "nowhere": 0, "misses": []}
for p in wiki:
    for sent in re.split(r"(?<=[.!?。])\s+|\n", p["markdown"]):
        cites = [int(x) for x in re.findall(r"\(p\.\s*(\d+)", sent)]
        if not cites: continue
        body = re.sub(r"\(p\.[^)]*\)", "", sent)
        nums = [n.replace(",", "") for n in num.findall(body) if len(n.replace(",", "")) >= 2]
        for n in nums[:3]:
            res["numericCites"] += 1
            if any(0 < c <= len(pages) and n in pages[c-1] for c in cites): res["onCitedPage"] += 1
            elif any(n in pg for pg in pages): res["otherPage"] += 1; res["misses"].append({"slug": p["slug"], "num": n, "cited": cites, "found": [i+1 for i, pg in enumerate(pages) if n in pg][:5]})
            else: res["nowhere"] += 1
print(json.dumps(res, ensure_ascii=False, indent=1))
