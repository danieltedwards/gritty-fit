# Rebuilding the built-in food database

`foods.json` is generated from the USDA FoodData Central **SR Legacy** CSV download.

```bash
curl -LO https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
unzip FoodData_Central_sr_legacy_food_csv_2018-04.zip
python3 tools/build_foods.py FoodData_Central_sr_legacy_food_csv_2018-04 foods.json
```

`popular.py` lists everyday foods that rank first in search, plus extra search words
(e.g. "oatmeal", "coke", "steak"). Edit it to tune search, then rebuild.
Row format: `[name, kcal, protein, carbs, fat, portions|0, aliases?]`, nutrients per 100 g.
