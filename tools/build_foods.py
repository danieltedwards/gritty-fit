import csv, json, sys, os, re
D = sys.argv[1]; OUT = sys.argv[2]
r = lambda f: csv.DictReader(open(os.path.join(D, f), encoding='utf-8'))
units = {row['id']: row['name'] for row in r('measure_unit.csv')}
skip_cats = {'3', '24', '27'}  # baby foods, AI/AN foods, QC materials
foods = {}
for row in r('food.csv'):
    if row['food_category_id'] in skip_cats: continue
    foods[row['fdc_id']] = {'n': row['description'], 'v': {}, 'p': []}
want = {'1008': 'k', '1003': 'p', '1005': 'c', '1004': 'f'}
for row in r('food_nutrient.csv'):
    f = foods.get(row['fdc_id'])
    if f is not None and row['nutrient_id'] in want and row['amount'] != '':
        f['v'][want[row['nutrient_id']]] = float(row['amount'])
for row in r('food_portion.csv'):
    f = foods.get(row['fdc_id'])
    if f is None: continue
    try: g = float(row['gram_weight']); amt = float(row['amount'] or 1)
    except ValueError: continue
    if g <= 0: continue
    unit = units.get(row['measure_unit_id'], '')
    unit = '' if unit == 'undetermined' else unit
    desc = ' '.join(x for x in [(('%g' % amt) if amt else ''), unit, row['modifier'] or row['portion_description']] if x).strip()
    desc = re.sub(r'\s+', ' ', desc)
    if desc and len(f['p']) < 6: f['p'].append([desc[:48], round(g, 1)])
import sys as _s; _s.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from popular import POPULAR
missing = [k for k in POPULAR if k not in {f['n'] for f in foods.values()}]
assert not missing, missing
rows = []
for f in foods.values():
    v = f['v']
    if 'k' not in v: continue
    row = [f['n'], round(v['k']), round(v.get('p', 0), 1), round(v.get('c', 0), 1), round(v.get('f', 0), 1), f['p'] or 0]
    if f['n'] in POPULAR: row.append(POPULAR[f['n']])
    elif not f['p']: row.pop()
    rows.append(row)
rows.sort(key=lambda x: x[0])
json.dump({'source': 'USDA FoodData Central, SR Legacy (2018). Values per 100 g.', 'foods': rows}, open(OUT, 'w'), separators=(',', ':'))
print(len(rows), os.path.getsize(OUT))
