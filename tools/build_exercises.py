#!/usr/bin/env python3
"""Builds exercises.json, GRIT's starter exercise library (names, other names, movement type, equipment,
muscles, coaching cues and swaps). Coaches add their own videos, cues and exercises on top of this in the app.
Run: python3 tools/build_exercises.py"""
import json, re, os

# (name, category, equipment, muscles, aliases, cues, swaps)
E = []
def x(name, cat, equip, muscles, aliases=(), cues=(), swaps=()):
    E.append(dict(name=name, cat=cat, equip=list(equip), muscles=list(muscles), aliases=list(aliases), cues=list(cues), swaps=list(swaps)))

Q, H, L, PU, PL, O, CA, CO, AR, SH, LG, GL, CN, PY, MO = ('Squat', 'Hinge', 'Lunge', 'Push', 'Pull', 'Olympic', 'Carry', 'Core', 'Arms',
    'Shoulders', 'Legs', 'Glutes', 'Conditioning', 'Plyo', 'Mobility')
QUADS, HAMS, GLUTES, BACK, LATS, CHEST, DELTS, TRIS, BIS, CORE, CALVES, TRAPS, GRIP, FULL = ('Quads', 'Hamstrings', 'Glutes', 'Lower back',
    'Lats', 'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Core', 'Calves', 'Traps', 'Grip', 'Full body')

# ---------- squat ----------
x('Back Squat', Q, ['barbell'], [QUADS, GLUTES], ['squat', 'barbell back squat', 'high bar back squat', 'back squat with belt', 'squats', 'bb back squat', 'barbell squat'],
  ['Brace hard before you unrack: big breath into the belly', 'Feet just outside hips, toes slightly out', 'Knees track over toes; sit between the hips', 'Drive the floor away and keep the chest up'],
  ['Front Squat', 'Safety Bar Squat', 'Goblet Squat', 'Leg Press'])
x('Low Bar Back Squat', Q, ['barbell'], [GLUTES, QUADS, HAMS], ['low bar squat', 'low bar back squat with belt'],
  ['Bar sits on the rear delts, below the spine of the shoulder blade', 'More hip hinge than a high-bar squat', 'Hips and chest rise together'], ['Back Squat', 'Box Squat'])
x('Pause Back Squat', Q, ['barbell'], [QUADS, GLUTES], ['paused back squat', 'paused squat', 'pause squat'],
  ['Hold 2 seconds in the hole and stay tight', 'Do not relax at the bottom', 'Drive up without bouncing'], ['Back Squat', 'Tempo Back Squat'])
x('Tempo Back Squat', Q, ['barbell'], [QUADS, GLUTES], ['tempo squat'], ['Own the lowering speed', 'Stay braced the whole rep'], ['Pause Back Squat'])
x('Front Squat', Q, ['barbell'], [QUADS, GLUTES, CORE], ['tempo front squat', 'double front squat', 'barbell front squat', 'front squat with belt', 'front squats', 'fs'],
  ['Elbows high, bar resting on the shoulders not the hands', 'Sit straight down, torso tall', 'Lead with the elbows out of the bottom'], ['Goblet Squat', 'Safety Bar Squat', 'Back Squat'])
x('Pause Front Squat', Q, ['barbell'], [QUADS, CORE], ['paused front squat'], ['2 second hold in the bottom, elbows up'], ['Front Squat'])
x('Overhead Squat', Q, ['barbell'], [QUADS, DELTS, CORE], ['ohs', 'overhead squats'],
  ['Wide snatch grip, push up into the bar', 'Armpits forward, bar over the mid-foot', 'Sit straight down under it'], ['Front Squat', 'Snatch Balance'])
x('Goblet Squat', Q, ['dumbbell', 'kettlebell'], [QUADS, GLUTES], ['dumbbell goblet squat', 'kb goblet squat', 'kettlebell goblet squat', 'db goblet squat'],
  ['Hold the weight tight to the chest', 'Elbows inside the knees at the bottom', 'Stay tall'], ['Front Squat', 'Leg Press', 'Box Squat'])
x('Speed Squat', Q, ['barbell'], [QUADS, GLUTES], ['dynamic squat', 'speed squats', 'dynamic box squat'], ['Light weight, fast out of the hole'], ['Box Squat'])
x('Box Squat', Q, ['barbell', 'box'], [GLUTES, HAMS, QUADS], ['barbell box squat', 'box squats'], ['Sit back to the box, pause, stay tight', 'Drive up explosively'], ['Back Squat'])
x('Safety Bar Squat', Q, ['ssb'], [QUADS, GLUTES], ['ss bar back squat', 'ssb back squat', 'ssb squat', 'ss bar squat', 'safety squat bar squat', 'ss bar dynamic squats'], ['Hands on the handles, push elbows down', 'Fight to stay upright'], ['Back Squat', 'Front Squat'])
x('Zercher Squat', Q, ['barbell'], [QUADS, CORE, BACK], ['zercher squats'], ['Bar in the crook of the elbows', 'Stay upright and braced'], ['Front Squat', 'Goblet Squat'])
x('Hack Squat', Q, ['machine'], [QUADS], ['machine hack squat'], ['Feet mid-platform', 'Full depth, control the bottom'], ['Leg Press', 'Back Squat'])
x('Leg Press', Q, ['machine'], [QUADS, GLUTES], ['machine leg press', 'high and wide leg press glute bias', 'high wide leg press'],
  ['Lower until hips start to tuck, no further', 'Press through the whole foot', 'Do not lock the knees hard'], ['Hack Squat', 'Goblet Squat'])
x('Belt Squat', Q, ['machine'], [QUADS, GLUTES], ['belt squats'], ['Stay upright, sit between the hips'], ['Leg Press', 'Goblet Squat'])
x('Smith Machine Squat', Q, ['smith'], [QUADS, GLUTES], ['smith squat'], ['Feet slightly forward of the bar'], ['Back Squat', 'Leg Press'])
x('Air Squat', Q, ['bodyweight'], [QUADS, GLUTES], ['bodyweight squat', 'air squats', 'prisoner squat'], ['Hips below knees, heels down', 'Stand all the way up'], ['Goblet Squat'])
x('Wall Sit', Q, ['bodyweight'], [QUADS], ['wall sits'], ['Thighs parallel, back flat to the wall'], ['Air Squat'])
x('Thruster', Q, ['barbell', 'dumbbell'], [QUADS, DELTS, FULL], ['thrusters', 'barbell thruster', 'dumbbell thruster', 'db thruster'],
  ['Front squat, then use the hip drive to press', 'One smooth movement, no pause', 'Finish with arms locked over the mid-foot'], ['Wall Ball', 'Dumbbell Thruster'])
x('Wall Ball', Q, ['medball'], [QUADS, DELTS, FULL], ['wall balls', 'wall ball shot', 'wall ball shots'], ['Full squat, catch into the next rep', 'Hit the target every rep'], ['Thruster'])

# ---------- hinge ----------
x('Deadlift', H, ['barbell'], [HAMS, GLUTES, BACK, GRIP], ['conventional deadlift', 'barbell deadlift', 'deadlifts', 'dl', 'deadlift competition stance'],
  ['Bar over the mid-foot, shins touch the bar', 'Pull the slack out of the bar before it moves', 'Push the floor away, hips and shoulders rise together', 'Lock out with glutes, do not lean back'],
  ['Trap Bar Deadlift', 'Romanian Deadlift', 'Kettlebell Deadlift'])
x('Sumo Deadlift', H, ['barbell'], [GLUTES, QUADS, HAMS], ['sumo deadlifts', 'sumo'], ['Wide stance, toes out, knees out', 'Chest up, hips close to the bar', 'Spread the floor'], ['Deadlift', 'Trap Bar Deadlift'])
x('Trap Bar Deadlift', H, ['trap bar'], [QUADS, GLUTES, HAMS], ['hex bar deadlift', 'trap bar deadlifts'], ['Stand in the middle, handles at the sides', 'Push through the floor, stand tall'], ['Deadlift'])
x('Deficit Deadlift', H, ['barbell'], [HAMS, GLUTES, BACK], ['deficit deadlifts', 'deadlift from deficit'], ['Stand on a 1–3 inch plate', 'Same setup, longer pull'], ['Deadlift'])
x('Paused Deadlift', H, ['barbell'], [HAMS, BACK], ['pause deadlift', 'deficit or paused deadlift'], ['Pause just below the knee for 1–2 seconds', 'Stay over the bar'], ['Deadlift'])
x('Block Pull', H, ['barbell'], [BACK, GLUTES, GRIP], ['rack pull', 'rack pulls', 'block pulls'], ['Bar at or just below the knee', 'Squeeze the lockout'], ['Deadlift'])
x('Snatch Grip Deadlift', H, ['barbell'], [BACK, TRAPS, HAMS], ['snatch grip deadlifts', 'snatch grip deadlift from deficit'], ['Wide grip, hips lower than a normal deadlift', 'Chest up, lats tight'], ['Deadlift'])
x('Romanian Deadlift', H, ['barbell', 'dumbbell'], [HAMS, GLUTES], ['rdl', 'rdls', 'barbell rdl', 'romanian deadlifts', 'barbell romanian deadlift'],
  ['Soft knees, push the hips back', 'Bar slides down the thighs', 'Stop when the hips stop moving back, keep the back flat'], ['Dumbbell Romanian Deadlift', 'Good Morning', 'Hip Thrust'])
x('Dumbbell Romanian Deadlift', H, ['dumbbell'], [HAMS, GLUTES], ['dumbbell rdl', 'db rdl', 'dumbbell straight leg deadlift'], ['Dumbbells slide down the front of the legs', 'Hips back, flat back'], ['Romanian Deadlift'])
x('Single-Leg Romanian Deadlift', H, ['dumbbell', 'kettlebell'], [HAMS, GLUTES], ['single leg rdl', 'unilateral rdl', 'unilateral rdls', 'sl rdl', 'single leg romanian deadlift'],
  ['Hips stay square to the floor', 'Reach the back leg long'], ['Dumbbell Romanian Deadlift'])
x('Stiff-Leg Deadlift', H, ['barbell'], [HAMS, BACK], ['sldl', 'stiff leg deadlift', 'straight leg deadlift'], ['Legs nearly straight, hinge from the hips'], ['Romanian Deadlift'])
x('Good Morning', H, ['barbell'], [HAMS, BACK, GLUTES], ['ss bar unilateral goodmornings', 'safety bar good morning', 'good mornings', 'goodmornings', 'barbell good morning'], ['Bar on the back like a squat', 'Hips back, slight knee bend, flat back'], ['Romanian Deadlift', 'Back Extension'])
x('Kettlebell Swing', H, ['kettlebell'], [GLUTES, HAMS, FULL], ['kb swing', 'kb swings', 'kettlebell swings', 'russian swing', 'american swing', 'swing', 'swings', 'two hand swing'],
  ['Hike the bell back high between the legs', 'Snap the hips, the arms just guide it', 'Plank at the top: glutes and abs tight'], ['Romanian Deadlift', 'Hip Thrust'])
x('Double Kettlebell Swing', H, ['kettlebell'], [GLUTES, HAMS], ['double swing', 'double swings'], ['Wider stance, same hip snap'], ['Kettlebell Swing'])
x('Kettlebell Deadlift', H, ['kettlebell'], [GLUTES, HAMS], ['kb deadlift', 'suitcase deadlift', 'suitcase deadlifts'], ['Bell between the feet, hips back'], ['Deadlift'])
x('Hip Thrust', GL, ['barbell'], [GLUTES], ['barbell hip thrust', 'hip thrusts', 'smith machine hip thrust', 'bb hip thrust'],
  ['Upper back on the bench edge, feet flat', 'Chin tucked, ribs down', 'Drive through the heels and squeeze at the top for 1 second'], ['Glute Bridge', 'Romanian Deadlift'])
x('Glute Bridge', GL, ['bodyweight', 'barbell'], [GLUTES], ['glute bridges', 'barbell glute bridge', 'frog pumps', 'frog pumps or glute bridge'], ['Ribs down, squeeze glutes to lift'], ['Hip Thrust'])
x('Back Extension', H, ['bench'], [BACK, GLUTES, HAMS], ['back extensions', 'hyperextension', 'hyperextensions', 'weighted back extension', 'weighted back extentions', 'glute back extentions', '45 degree back extension', 'hyperextensions with barbell'],
  ['Pad just below the hip crease', 'Round slightly to bias glutes, or stay flat for low back'], ['Reverse Hyper', 'Good Morning'])
x('Reverse Hyper', H, ['machine'], [GLUTES, BACK], ['reverse hypers', 'reverse hyperextension'], ['Swing the legs up with the glutes, control down'], ['Back Extension'])
x('Glute-Ham Raise', H, ['ghd'], [HAMS, GLUTES], ['ghr', 'glute ham raise'], ['Knees on the pad, body straight', 'Pull yourself up with the hamstrings'], ['Nordic Hamstring Curl', 'Lying Leg Curl'])
x('Nordic Hamstring Curl', H, ['bodyweight'], [HAMS], ['nordic ham curl', 'nordic curls', 'nordics', 'nordic hamstring curls'], ['Lower as slowly as you can, hips straight', 'Catch yourself and push back up'], ['Glute-Ham Raise'])
x('Cable Pull-Through', H, ['cable', 'band'], [GLUTES, HAMS], ['pull throughs', 'band pull throughs', 'cable pull through', 'band or cable pull throughs'], ['Hinge back, rope between the legs', 'Squeeze glutes to stand'], ['Kettlebell Swing'])

# ---------- lunge / single leg ----------
x('Bulgarian Split Squat', L, ['dumbbell', 'barbell', 'bodyweight'], [QUADS, GLUTES], ['ss bar rear leg elevated split squats', 'dual kettlebell rear foot elevated split squat', 'rear foot elevated split squat', 'rfess', 'db bulgarian split squat', 'dumbbell bulgarian split squat', 'rear leg elevated split squat', 'rear leg elevated split squats', 'bulgarian split squats'],
  ['Back foot laces down on the bench', 'Most of the weight on the front foot', 'Torso tall for quads, lean slightly for glutes'], ['Split Squat', 'Reverse Lunge', 'Step-Up'])
x('Split Squat', L, ['dumbbell', 'barbell', 'bodyweight'], [QUADS, GLUTES], ['barbell split squat', 'dumbbell split squat', 'single arm dumbbell split squat', 'split squats'], ['Back knee to the floor, straight down and up'], ['Bulgarian Split Squat'])
x('Reverse Lunge', L, ['dumbbell', 'barbell', 'bodyweight'], [QUADS, GLUTES], ['reverse lunges', 'dumbbell reverse lunge', 'db reverse lunge'], ['Step back, front shin stays vertical', 'Push through the front heel'], ['Split Squat', 'Walking Lunge'])
x('Walking Lunge', L, ['dumbbell', 'barbell', 'bodyweight'], [QUADS, GLUTES], ['walking lunges', 'dumbbell walking lunges', 'walking db lunge', 'db walking lunge', 'lunges', 'lunge', 'dumbbell lunges', 'barbell lunges', 'weighted lunge'],
  ['Long enough step that both knees hit 90°', 'Back knee kisses the floor'], ['Reverse Lunge'])
x('Front Rack Lunge', L, ['barbell', 'kettlebell'], [QUADS, CORE], ['barbell front rack lunges', 'front rack lunges', 'front rack reverse lunge'], ['Elbows up, torso tall'], ['Walking Lunge'])
x('Overhead Lunge', L, ['barbell', 'dumbbell', 'plate'], [QUADS, DELTS, CORE], ['overhead lunges', 'overhead walking lunge'], ['Arms locked, bar over the mid-foot'], ['Walking Lunge'])
x('Step-Up', L, ['dumbbell', 'box'], [QUADS, GLUTES], ['step ups', 'dumbbell step ups', 'box step ups', 'db step up'], ['Whole foot on the box', 'Drive through the top leg, no push from the bottom foot'], ['Bulgarian Split Squat'])
x('Lateral Lunge', L, ['bodyweight', 'dumbbell'], [QUADS, GLUTES], ['side lunge', 'lateral lunges', 'cossack squat'], ['Sit back into one hip, other leg straight'], ['Reverse Lunge'])
x('Pistol Squat', L, ['bodyweight'], [QUADS, GLUTES, CORE], ['pistol', 'pistols', 'single leg squat'], ['Free leg straight ahead, sit down slowly'], ['Bulgarian Split Squat'])

# ---------- push ----------
x('Bench Press', PU, ['barbell'], [CHEST, TRIS, DELTS], ['barbell bench press', 'bench', 'flat bench press', 'bb bench', 'bench press competition grip', 'bench press competition grip pausing each rep'],
  ['Shoulder blades pinched and down, slight arch', 'Feet planted, drive with the legs', 'Touch the lower chest, press back toward the face'], ['Dumbbell Bench Press', 'Push-Up', 'Floor Press'])
x('Pause Bench Press', PU, ['barbell'], [CHEST, TRIS], ['paused bench press', 'pause bench', 'bench press pause'], ['Full 1–2 second pause on the chest, stay tight'], ['Bench Press'])
x('Speed Bench Press', PU, ['barbell'], [CHEST, TRIS], ['dynamic bench press', 'velocity bench press', 'speed bench'], ['Light weight, move the bar as fast as possible', 'Same setup as your heavy bench'], ['Bench Press'])
x('Close-Grip Bench Press', PU, ['barbell'], [TRIS, CHEST], ['close grip bench press', 'close grip bench', 'cgbp', 'close grip presses', 'closegrip presses', 'close grip bench press triceps'], ['Hands shoulder-width', 'Elbows tucked closer to the body'], ['Floor Press', 'Dip'])
x('Wide-Grip Bench Press', PU, ['barbell'], [CHEST], ['wide grip bench press'], ['Hands wider than competition grip'], ['Bench Press'])
x('Incline Bench Press', PU, ['barbell'], [CHEST, DELTS, TRIS], ['incline barbell bench press', 'incline bench', 'incline press', 'incline barbell bench press pause at chest'], ['30–45° incline', 'Touch the upper chest'], ['Incline Dumbbell Press'])
x('Floor Press', PU, ['barbell', 'dumbbell'], [TRIS, CHEST], ['floor presses', 'dumbbell floor press', 'close grip floor press'], ['Upper arms touch the floor, pause, press'], ['Close-Grip Bench Press'])
x('Dumbbell Bench Press', PU, ['dumbbell'], [CHEST, TRIS, DELTS], ['db bench press', 'dumbbell bench', 'db bench', 'flat dumbbell bench press', 'dumbbell flat bench press'], ['Dumbbells over the shoulders at the top', 'Lower to the sides of the chest, elbows ~45°'], ['Bench Press', 'Push-Up'])
x('Incline Dumbbell Press', PU, ['dumbbell'], [CHEST, DELTS], ['incline dumbbell bench press', 'dumbbell incline bench press', 'incline db press', 'incline dumbbell press'], ['30–45° bench', 'Elbows slightly in, press up and together'], ['Incline Bench Press'])
x('Machine Chest Press', PU, ['machine'], [CHEST, TRIS], ['chest press', 'machine press'], ['Handles at mid-chest, push and squeeze'], ['Dumbbell Bench Press'])
x('Push-Up', PU, ['bodyweight'], [CHEST, TRIS, CORE], ['push up', 'push ups', 'pushups', 'pushup', 'hand release push up', 'pushups on trx'], ['Body in one straight line', 'Chest to the floor, elbows ~45°'], ['Incline Push-Up', 'Dumbbell Bench Press'])
x('Incline Push-Up', PU, ['bodyweight', 'box'], [CHEST, TRIS], ['incline push up', 'box push up'], ['Hands on a bench or box, same straight line'], ['Push-Up'])
x('Decline Push-Up', PU, ['bodyweight'], [CHEST, DELTS], ['decline push up', 'feet elevated push up'], ['Feet up on a box'], ['Push-Up'])
x('Ring Push-Up', PU, ['rings'], [CHEST, CORE], ['ring push up', 'ring push ups'], ['Turn the rings out at the top'], ['Push-Up'])
x('Dip', PU, ['bodyweight'], [TRIS, CHEST], ['dips', 'parallel bar dip', 'bar dips', 'weighted dips', 'ring dip', 'ring dips'], ['Shoulders down, slight forward lean', 'Lower until shoulders are just below elbows'], ['Close-Grip Bench Press', 'Bench Dip'])
x('Overhead Press', PU, ['barbell'], [DELTS, TRIS], ['strict press', 'press', 'military press', 'ohp', 'barbell overhead press', 'standing press', 'barbell strict press', 'strict presses', 'shoulder press'],
  ['Bar on the front delts, elbows slightly in front', 'Squeeze glutes, ribs down', 'Head through once the bar passes the face'], ['Dumbbell Shoulder Press', 'Push Press', 'Landmine Press'])
x('Push Press', PU, ['barbell'], [DELTS, TRIS, QUADS], ['push presses', 'barbell push press', 'snatch push press'], ['Short dip straight down', 'Drive with the legs, finish with the arms'], ['Overhead Press', 'Dumbbell Push Press'])
x('Dumbbell Shoulder Press', PU, ['dumbbell'], [DELTS, TRIS], ['db shoulder press', 'dumbbell press', 'seated dumbbell shoulder press', 'dumbbell shoulder press seated', 'db press', 'single arm dumbbell shoulder press', 'seated db press'], ['Press up and slightly in', 'Do not flare the ribs'], ['Overhead Press', 'Landmine Press'])
x('Dumbbell Push Press', PU, ['dumbbell', 'kettlebell'], [DELTS, QUADS], ['db push press', 'dumbbell or kettlebell push press'], ['Dip and drive, lock out overhead'], ['Push Press'])
x('Seated Barbell Press', PU, ['barbell'], [DELTS, TRIS], ['seated barbell shoulder press', 'seated press'], ['Back on the pad, press straight up'], ['Overhead Press'])
x('Landmine Press', PU, ['landmine'], [DELTS, CHEST], ['landmine press', 'split stance landmine press', 'split stance landmine push'], ['Press up and forward, reach at the top'], ['Dumbbell Shoulder Press'])
x('Kettlebell Press', PU, ['kettlebell'], [DELTS, TRIS], ['kb press', 'kettlebell military press', 'double military press', 'double kettlebell press', 'kb bottom up z press', 'kb clean press'], ['Bell sits on the forearm, wrist straight', 'Press up and slightly out'], ['Dumbbell Shoulder Press'])
x('Handstand Push-Up', PU, ['bodyweight'], [DELTS, TRIS], ['hspu', 'handstand push up', 'handstand push ups', 'strict hspu'], ['Head and hands make a triangle', 'Squeeze legs together, press to lockout'], ['Pike Push-Up', 'Dumbbell Shoulder Press'])
x('Pike Push-Up', PU, ['bodyweight'], [DELTS, TRIS], ['pike push up'], ['Hips high, head to the floor between hands'], ['Push-Up'])
x('Z Press', PU, ['barbell', 'dumbbell'], [DELTS, CORE], ['z press'], ['Sit on the floor legs straight, press without leaning back'], ['Overhead Press'])

# ---------- pull ----------
x('Pull-Up', PL, ['bodyweight'], [LATS, BIS], ['ring pull up', '1b pull ups strict', 'pull up', 'pull ups', 'pullups', 'pullup', 'strict pull up', 'strict pull ups', 'wide grip pull ups', 'pull ups wide pronated'],
  ['Start from a dead hang, shoulders engaged', 'Pull the elbows down to the ribs', 'Chin over the bar, control down'], ['Lat Pulldown', 'Ring Row', 'Band-Assisted Pull-Up'])
x('Chin-Up', PL, ['bodyweight'], [LATS, BIS], ['chin up', 'chin ups', 'chinups', 'supinated pull up'], ['Palms facing you', 'Chest to the bar'], ['Pull-Up', 'Lat Pulldown'])
x('Weighted Pull-Up', PL, ['bodyweight', 'belt'], [LATS, BIS], ['weighted pull up', 'weighted pull ups', 'weighted chin up'], ['Same strict pull, weight on a belt or between the feet'], ['Pull-Up'])
x('Kipping Pull-Up', PL, ['bodyweight'], [LATS, CORE], ['kipping pull ups', 'kipping pull up', 'butterfly pull up'], ['Hollow-arch rhythm from the shoulders', 'Push away from the bar at the top'], ['Pull-Up'])
x('Chest-to-Bar Pull-Up', PL, ['bodyweight'], [LATS, BIS], ['chest to bar', 'c2b', 'chest to bar pull up'], ['Pull until the chest touches the bar'], ['Pull-Up'])
x('Muscle-Up', PL, ['rings', 'bodyweight'], [LATS, CHEST, TRIS], ['muscle up', 'muscle ups', 'bar muscle up', 'ring muscle up'], ['Pull to the hips, turn over fast', 'Press out to lockout'], ['Chest-to-Bar Pull-Up', 'Dip'])
x('Band-Assisted Pull-Up', PL, ['band'], [LATS, BIS], ['banded pull up', 'assisted pull up', 'band assisted pull up'], ['Same strict pull with a band under the knee or foot'], ['Pull-Up'])
x('Lat Pulldown', PL, ['cable', 'machine'], [LATS, BIS], ['lat pull down', 'pulldown', 'wide grip lat pulldown', 'neutral grip lat pulldown', 'lat pulldowns', 'lat pulldown or pull up'], ['Lean back slightly, chest up', 'Pull elbows down to the sides'], ['Pull-Up', 'Straight-Arm Pulldown'])
x('Straight-Arm Pulldown', PL, ['cable'], [LATS], ['straight arm pulldown', 'standing lat pushdown', 'lat pushdown'], ['Arms long, sweep the bar to the thighs'], ['Lat Pulldown', 'Dumbbell Pullover'])
x('Barbell Row', PL, ['barbell'], [BACK, LATS, BIS], ['single arm barbell row', 'm row', 'bent over row', 'bent over rows', 'bentover rows', 'barbell rows', 'barbell row pronated', 'bent row', 'bb row', 'row'],
  ['Hinge to about 45°, flat back', 'Pull the bar to the belly button', 'Squeeze the shoulder blades, control down'], ['Dumbbell Row', 'Chest-Supported Row', 'Seated Cable Row'])
x('Pendlay Row', PL, ['barbell'], [BACK, LATS], ['pendlay rows'], ['Bar back to the floor every rep', 'Torso parallel, explode up'], ['Barbell Row'])
x('Dumbbell Row', PL, ['dumbbell'], [LATS, BACK, BIS], ['db row', 'one arm dumbbell row', 'single arm dumbbell row', 'dumbbell bent over row', 'one arm row', 'dumbbell rows'], ['Hand and knee on the bench, flat back', 'Row the elbow to the hip'], ['Barbell Row', 'Seated Cable Row'])
x('Chest-Supported Row', PL, ['dumbbell', 'machine'], [BACK, LATS], ['chest supported row', 'chest supported dumbbell row', 'incline dumbbell row', 'seal row', 'incline seal row', 't bar row', 'landmine t bar row'], ['Chest on the pad the whole time', 'Pull and pause at the top'], ['Dumbbell Row'])
x('Seated Cable Row', PL, ['cable'], [BACK, LATS], ['cable row', 'seated row', 'close grip cable row', 'low row'], ['Sit tall, pull to the stomach', 'Shoulders down and back'], ['Barbell Row', 'Chest-Supported Row'])
x('Ring Row', PL, ['rings', 'trx'], [BACK, BIS], ['ring rows', 'trx row', 'inverted row', 'bodyweight row', 'trx rows'], ['Body straight, pull the chest to the hands'], ['Seated Cable Row', 'Pull-Up'])
x('Kettlebell Row', PL, ['kettlebell'], [BACK, LATS], ['kb row', 'kettlebell bat wing rows', 'kettlebell batwing rows', 'bat wing row', 'double bent over row', 'renegade row'], ['Flat back, row to the hip'], ['Dumbbell Row'])
x('Band Row', PL, ['band'], [BACK], ['band rows', 'banded rows'], ['Squeeze shoulder blades at the end'], ['Seated Cable Row'])
x('Face Pull', SH, ['cable', 'band'], [DELTS, TRAPS], ['face pulls', 'seated face pulls', 'rope face pull'], ['Rope to the eyes, thumbs back', 'Finish like a double-biceps pose'], ['Rear Delt Fly', 'Band Pull-Apart'])
x('Band Pull-Apart', SH, ['band'], [DELTS, TRAPS], ['band pull aparts', 'pull aparts', 'band pull apart'], ['Arms straight, pull the band to the chest'], ['Face Pull'])
x('Dumbbell Pullover', PL, ['dumbbell'], [LATS, CHEST], ['pullovers', 'dumbbell pullovers', 'db pullover'], ['Slight elbow bend, stretch behind the head'], ['Straight-Arm Pulldown'])
x('Rope Climb', PL, ['rope'], [LATS, GRIP, BIS], ['rope climbs', 'legless rope climb'], ['Lock the rope with the feet, stand up, reach'], ['Pull-Up'])

# ---------- olympic ----------
x('Snatch', O, ['barbell'], [FULL], ['squat snatch', 'full snatch', 'snatches', 'snatch max effort', 'max effort snatch', 'snatch max effort competition style'], ['Bar close the whole way', 'Finish the pull, then pull yourself under', 'Catch in a full overhead squat'], ['Power Snatch', 'Hang Snatch', 'Dumbbell Snatch'])
x('Power Snatch', O, ['barbell'], [FULL], ['power snatches'], ['Catch above parallel, arms locked'], ['Snatch', 'Hang Power Snatch'])
x('Hang Snatch', O, ['barbell'], [FULL], ['hang snatches', 'hang snatch below knee', 'hang squat snatch'], ['Start above the knee, hips back, then extend'], ['Snatch'])
x('Hang Power Snatch', O, ['barbell'], [FULL], ['hang power snatches'], ['From the hang, catch above parallel'], ['Power Snatch'])
x('Muscle Snatch', O, ['barbell'], [DELTS, TRAPS], ['muscle snatches'], ['No re-bend of the knees, press out overhead'], ['Snatch'])
x('Snatch Balance', O, ['barbell'], [QUADS, DELTS], ['heaving snatch balance', 'snatch balances'], ['Drive down under the bar fast'], ['Overhead Squat'])
x('Snatch Pull', O, ['barbell'], [BACK, TRAPS, HAMS], ['snatch pulls', 'snatch pull on riser', 'lasha snatch pulls', 'snatch high pull', 'hang snatch grip high pulls'], ['Same path as the snatch, finish tall'], ['Snatch Grip Deadlift'])
x('Snatch Deadlift', O, ['barbell'], [BACK, HAMS], ['snatch deadlifts'], ['Snatch start position, slow and exact'], ['Snatch Grip Deadlift'])
x('Clean', O, ['barbell'], [FULL], ['squat clean', 'cleans', 'full clean', 'clean max effort', 'max effort clean', 'clean max effort competition style'], ['Bar close, extend fully', 'Elbows fast through, catch in a front squat'], ['Power Clean', 'Hang Clean', 'Dumbbell Clean'])
x('Power Clean', O, ['barbell'], [FULL], ['power cleans', 'barbell power clean'], ['Explode up, catch above parallel', 'Elbows up fast'], ['Clean', 'Hang Power Clean'])
x('Hang Clean', O, ['barbell'], [FULL], ['hang cleans', 'hang squat clean'], ['Start above the knee, hips back, extend'], ['Clean'])
x('Hang Power Clean', O, ['barbell'], [FULL], ['hang power cleans'], ['From the hang, catch above parallel'], ['Power Clean'])
x('Clean Pull', O, ['barbell'], [BACK, TRAPS, HAMS], ['clean pulls', 'clean pull on riser', 'clean high pull'], ['Same path as the clean, finish tall'], ['Deadlift'])
x('Clean Deadlift', O, ['barbell'], [BACK, HAMS], ['clean deadlifts'], ['Clean start position, chest up'], ['Deadlift'])
x('Block Clean', O, ['barbell', 'blocks'], [FULL], ['clean from block', 'clean from blocks', 'block cleans'], ['Start from blocks, no swing'], ['Hang Clean'])
x('Clean and Jerk', O, ['barbell'], [FULL], ['clean jerk', 'c j', 'clean and jerks', 'clean and jerk max effort', 'clean and jerk max effort competition style', 'clean jerk max effort'], ['Stand the clean up fully, reset the grip', 'Dip and drive, punch under'], ['Clean', 'Push Jerk'])
x('Jerk', O, ['barbell'], [DELTS, QUADS], ['split jerk', 'jerks', 'jerk from rack', 'jerk from blocks'], ['Straight dip, violent drive', 'Punch under into a split'], ['Push Jerk', 'Push Press'])
x('Push Jerk', O, ['barbell'], [DELTS, QUADS], ['push jerks'], ['Dip, drive, re-dip under the bar with locked arms'], ['Push Press', 'Jerk'])
x('Power Jerk', O, ['barbell'], [DELTS, QUADS], ['power jerks'], ['Like a push jerk, feet move out'], ['Push Jerk'])
x('Dumbbell Snatch', O, ['dumbbell'], [FULL], ['db snatch', 'dumbbell snatches', 'single arm dumbbell snatch'], ['Hinge, explode, lock out overhead in one move'], ['Kettlebell Snatch', 'Power Snatch'])
x('Dumbbell Clean', O, ['dumbbell'], [FULL], ['db clean', 'dumbbell cleans', 'dumbbell hang clean'], ['Hips drive, catch on the shoulders'], ['Power Clean'])
x('Dumbbell Clean and Press', O, ['dumbbell'], [FULL], ['dumbbell clean and press', 'db clean and press', 'dumbbell clean and jerk'], ['Clean to the shoulders, then press or jerk'], ['Clean and Jerk'])
x('Kettlebell Snatch', O, ['kettlebell'], [FULL], ['kb snatch', 'kettlebell snatches'], ['Hike, snap the hips, punch through at the top'], ['Dumbbell Snatch'])
x('Kettlebell Clean', O, ['kettlebell'], [FULL], ['kb clean', 'double kettlebell clean', 'kettlebell cleans'], ['Bell travels close, no banging the wrist'], ['Dumbbell Clean'])
x('Ground to Overhead', O, ['barbell', 'dumbbell', 'plate'], [FULL], ['ground to overhead', 'g2oh'], ['Any method from floor to locked out overhead'], ['Clean and Jerk', 'Dumbbell Snatch'])

# ---------- carry ----------
x("Farmer's Carry", CA, ['dumbbell', 'kettlebell', 'trap bar'], [GRIP, TRAPS, CORE], ['farmers carry', 'farmer carry', 'farmers walk', 'farmer walk', "farmer's walk"], ['Tall posture, shoulders down', 'Short quick steps'], ['Suitcase Carry'])
x('Suitcase Carry', CA, ['dumbbell', 'kettlebell'], [CORE, GRIP], ['suitcase carries', 'unilateral farmers walk', 'single arm farmers carry', 'one arm farmers walk'], ['Weight on one side, do not lean'], ["Farmer's Carry"])
x('Overhead Carry', CA, ['dumbbell', 'kettlebell', 'plate'], [DELTS, CORE], ['overhead carry', 'waiter walk', 'overhead walk'], ['Arm locked, ribs down'], ['Suitcase Carry'])
x('Front Rack Carry', CA, ['kettlebell', 'barbell'], [CORE], ['front rack carry', 'zercher carry', 'axle bar zercher carries'], ['Elbows up, breathe behind the brace'], ["Farmer's Carry"])
x('Yoke Carry', CA, ['yoke'], [FULL, CORE], ['yoke carries', 'yoke walk'], ['Brace hard, short fast steps'], ["Farmer's Carry"])
x('Sandbag Carry', CA, ['sandbag'], [FULL, CORE], ['sandbag carry', 'bear hug carry'], ['Hug it high, stay tall'], ["Farmer's Carry"])
x('Sled Push', CN, ['sled'], [QUADS, FULL], ['sled push', 'prowler push', 'prowler'], ['Low body angle, drive with the legs'], ['Sled Drag'])
x('Sled Drag', CN, ['sled'], [QUADS, HAMS], ['sled drag', 'tire drag', 'backwards sled drag'], ['Stay low and keep tension on the strap'], ['Sled Push'])
x('Tire Flip', CN, ['tire'], [FULL], ['tire flips'], ['Chest into the tire, drive forward with the hips'], ['Deadlift'])

# ---------- core ----------
x('Plank', CO, ['bodyweight'], [CORE], ['planks', 'front plank', 'weighted plank', 'weighted planks'], ['Elbows under shoulders', 'Squeeze glutes and quads, ribs down'], ['Dead Bug'])
x('Side Plank', CO, ['bodyweight'], [CORE], ['side planks'], ['Hips high, body in a line'], ['Plank'])
x('Dead Bug', CO, ['bodyweight'], [CORE], ['dead bugs'], ['Low back pressed down the whole time', 'Move slowly'], ['Plank'])
x('Bird Dog', CO, ['bodyweight'], [CORE, BACK], ['bird dogs'], ['Reach long, hips stay level'], ['Dead Bug'])
x('Hollow Hold', CO, ['bodyweight'], [CORE], ['hollow body hold', 'hollow rock', 'hollow rocks'], ['Low back glued to the floor', 'Arms and legs long'], ['Dead Bug'])
x('Hanging Leg Raise', CO, ['bodyweight'], [CORE], ['hanging leg raises', 'leg raise', 'leg raises', 'hanging knee raise', 'knee raises', 'power tower straight leg raise'], ['No swinging', 'Curl the pelvis up at the top'], ['Toes-to-Bar', 'Reverse Crunch'])
x('Toes-to-Bar', CO, ['bodyweight'], [CORE, LATS], ['toes to bar', 't2b', 'ttb', 'toes to bars'], ['Push the bar away as the legs come up'], ['Hanging Leg Raise', 'Knees-to-Elbows'])
x('Knees-to-Elbows', CO, ['bodyweight'], [CORE], ['knees to elbows', 'kte', 'k2e'], ['Knees touch elbows, control the swing'], ['Hanging Leg Raise'])
x('Sit-Up', CO, ['bodyweight'], [CORE], ['sit up', 'sit ups', 'situps', 'abmat sit up', 'weighted sit up', 'atomic sit up', 'decline reverse sit up'], ['Touch the floor behind, then the feet'], ['Crunch'])
x('GHD Sit-Up', CO, ['ghd'], [CORE], ['ghd sit up', 'ghd sit ups', 'ghds', 'ghd or decline sit up'], ['Build up slowly, these are hard on the abs'], ['Sit-Up'])
x('Crunch', CO, ['bodyweight'], [CORE], ['crunches'], ['Curl the ribs to the hips'], ['Sit-Up'])
x('Reverse Crunch', CO, ['bodyweight'], [CORE], ['reverse crunches'], ['Curl the hips off the floor'], ['Hanging Leg Raise'])
x('Cable Crunch', CO, ['cable'], [CORE], ['cable crunches', 'kneeling cable crunch'], ['Round the spine down, hips stay still'], ['Crunch'])
x('Ab Wheel Rollout', CO, ['ab wheel'], [CORE], ['ab roller', 'ab rollout', 'ab wheel', 'ring ab fallouts', 'trx or ring ab fallouts', 'trx fallout'], ['Ribs down, roll out only as far as you can hold'], ['Plank'])
x('V-Up', CO, ['bodyweight'], [CORE], ['v ups', 'v up', 'v-ups'], ['Touch the toes at the top'], ['Sit-Up'])
x('Pallof Press', CO, ['cable', 'band'], [CORE], ['pallof press', 'pallof'], ['Resist the twist, press straight out'], ['Side Plank'])
x('Russian Twist', CO, ['bodyweight', 'plate'], [CORE], ['russian twists'], ['Rotate the ribcage, not just the arms'], ['Pallof Press'])
x('Windmill', CO, ['kettlebell'], [CORE, DELTS], ['kettlebell windmill', 'double windmill', 'windmills'], ['Eyes on the bell, hinge to the side'], ['Side Plank'])
x('Turkish Get-Up', CO, ['kettlebell'], [FULL, CORE, DELTS], ['turkish get up', 'tgu', 'get up', 'get ups'], ['Eyes on the bell, arm locked', 'Slow and in steps'], ['Windmill'])
x('L-Sit', CO, ['bodyweight'], [CORE], ['l sit', 'l-sit hold'], ['Push down hard, legs straight out'], ['Hollow Hold'])
x('Floor Wiper', CO, ['barbell'], [CORE], ['floor wipers'], ['Bar locked over the chest, feet side to side'], ['Russian Twist'])

# ---------- arms ----------
x('Barbell Curl', AR, ['barbell', 'ez bar'], [BIS], ['barbell bicep curl', 'barbell curls', 'supinated grip barbell bicep curl', 'ez bar curl', 'bicep curl', 'biceps curl', 'curls', 'fat bar curls', 'axle bar curls'], ['Elbows pinned at the sides', 'No swinging'], ['Dumbbell Curl'])
x('Reverse Curl', AR, ['barbell', 'ez bar'], [BIS, GRIP], ['pronated grip barbell bicep curl', 'reverse grip curl'], ['Overhand grip, same strict curl'], ['Hammer Curl'])
x('Dumbbell Curl', AR, ['dumbbell'], [BIS], ['supinated dumbbell curl', 'db curl', 'dumbbell bicep curl', 'dumbbell curls', 'supinated dumbbell curls seated', 'dumbbell supinated curl', 'seated dumbbell curl', 'incline dumbbell curl'], ['Turn the pinky up at the top'], ['Barbell Curl', 'Cable Curl'])
x('Hammer Curl', AR, ['dumbbell'], [BIS, GRIP], ['dumbbell hammer curl', 'hammer curls'], ['Thumbs up the whole rep'], ['Dumbbell Curl'])
x('Preacher Curl', AR, ['ez bar', 'dumbbell'], [BIS], ['preacher curls', 'ez bar preacher curl', 'preacher curls 21s'], ['Arm flat on the pad, full stretch at the bottom'], ['Dumbbell Curl'])
x('Cable Curl', AR, ['cable'], [BIS], ['cable curls', 'dual cable bicep curl', 'band curls'], ['Elbows still, squeeze at the top'], ['Dumbbell Curl'])
x('Zottman Curl', AR, ['dumbbell'], [BIS, GRIP], ['zottman curls'], ['Curl palms up, lower palms down'], ['Hammer Curl'])
x('Triceps Pushdown', AR, ['cable', 'band'], [TRIS], ['tricep pushdown', 'triceps pushdowns', 'rope pushdown', 'cable pushdown', 'band push downs', 'band or cable pushdowns'], ['Elbows pinned, lock out at the bottom'], ['Overhead Triceps Extension'])
x('Overhead Triceps Extension', AR, ['cable', 'dumbbell'], [TRIS], ['overhead cable tricep extension', 'overhead tricep extension', 'single dumbbell overhead extension', 'dumbbell triceps extension', 'overhead dumbbell triceps'], ['Elbows point up, full stretch'], ['Triceps Pushdown', 'Skull Crusher'])
x('Skull Crusher', AR, ['ez bar', 'dumbbell', 'barbell'], [TRIS], ['skull crushers', 'barbell skull crusher', 'dumbbell skull crushers', 'nosebreakers', 'nose breakers', 'lying triceps extension'], ['Lower toward the forehead or just behind', 'Elbows stay narrow'], ['Overhead Triceps Extension'])
x('Bench Dip', AR, ['bench', 'bodyweight'], [TRIS], ['bench dips'], ['Hands behind on a bench, elbows straight back'], ['Dip'])
x('Wrist Curl', AR, ['dumbbell', 'barbell'], [GRIP], ['wrist curls', 'forearm curl'], ['Forearms on thighs, curl just the wrist'], ['Hammer Curl'])

# ---------- shoulders ----------
x('Lateral Raise', SH, ['dumbbell', 'cable'], [DELTS], ['lateral raises', 'dumbbell lateral raise', 'db lateral raises', 'side raise', 'seated dumbbell lateral raises', 'standing dumbbell lateral raise', 'chest support lateral dumbbell raises', 'cable lateral raise'], ['Lead with the elbows, slight bend', 'Up to shoulder height, no shrug'], ['Cable Lateral Raise', 'Upright Row'])
x('Rear Delt Fly', SH, ['dumbbell', 'machine', 'cable'], [DELTS], ['reverse fly', 'rear delt flyes', 'bent over lateral raise', 'reverse pec deck', 'reverse pec deck fly', 'rear delt raise'], ['Arms out wide, squeeze the rear shoulder'], ['Face Pull', 'Band Pull-Apart'])
x('Front Raise', SH, ['dumbbell', 'plate'], [DELTS], ['front raises', 'dumbbell front raise', 'plate front raises', 'plate front raise'], ['Raise to eye level, control down'], ['Overhead Press'])
x('Upright Row', SH, ['barbell', 'dumbbell', 'kettlebell'], [DELTS, TRAPS], ['upright rows', 'kettlebell upright rows', 'db or kb upright rows'], ['Elbows lead, stop around shoulder height'], ['Lateral Raise'])
x('Shrug', SH, ['barbell', 'dumbbell', 'trap bar'], [TRAPS], ['shrugs', 'barbell shrug', 'dumbbell shrug'], ['Straight up toward the ears, pause'], ["Farmer's Carry"])
x('Arnold Press', SH, ['dumbbell'], [DELTS], ['arnold presses'], ['Rotate palms out as you press'], ['Dumbbell Shoulder Press'])

# ---------- chest isolation ----------
x('Dumbbell Fly', PU, ['dumbbell'], [CHEST], ['dumbbell flyes', 'flat dumbbell fly', 'db fly', 'incline dumbbell fly', 'dumbbell flys'], ['Soft elbows, wide arc, stretch the chest'], ['Cable Fly', 'Pec Deck'])
x('Cable Fly', PU, ['cable'], [CHEST], ['cable flyes', 'cable crossover', 'incline cable fly', 'cable flys'], ['Hug a big tree, squeeze at the middle'], ['Dumbbell Fly'])
x('Pec Deck', PU, ['machine'], [CHEST], ['pec deck fly', 'machine fly', 'pec fly'], ['Elbows slightly bent, squeeze the chest'], ['Cable Fly'])

# ---------- legs isolation / glutes ----------
x('Leg Extension', LG, ['machine'], [QUADS], ['leg extensions', 'quad extension'], ['Pause at the top, slow down'], ['Split Squat'])
x('Lying Leg Curl', LG, ['machine'], [HAMS], ['lying hamstring curl', 'leg curl', 'leg curls', 'lying leg curls', 'hamstring curl', 'lying hamstring curl single leg'], ['Hips pressed down, squeeze, slow lower'], ['Seated Leg Curl', 'Nordic Hamstring Curl'])
x('Seated Leg Curl', LG, ['machine'], [HAMS], ['seated hamstring curl', 'seated leg curls'], ['Lean slightly forward for a better stretch'], ['Lying Leg Curl'])
x('Swiss Ball Leg Curl', LG, ['trx', 'ball'], [HAMS, GLUTES], ['trx leg curls', 'stability ball leg curl', 'slider leg curl', 'trx leg curl', 'seated band leg curls'], ['Hips high, curl heels to the glutes'], ['Lying Leg Curl'])
x('Standing Calf Raise', LG, ['machine', 'barbell', 'bodyweight'], [CALVES], ['calf raise', 'calf raises', 'standing calf raises', 'barbell standing calf raises', 'barbell deficit standing calf raises'], ['Full stretch at the bottom, pause at the top'], ['Seated Calf Raise'])
x('Seated Calf Raise', LG, ['machine'], [CALVES], ['seated calf raises'], ['Slow stretch, hard squeeze'], ['Standing Calf Raise'])
x('Hip Abduction', GL, ['machine', 'band'], [GLUTES], ['band seated hip abduction', 'extra range side lying hip abduction', 'hip abduction machine', 'abductor', 'banded abduction', 'seated hip abduction'], ['Lean forward slightly for upper glutes'], ['Lateral Band Walk'])
x('Hip Adduction', LG, ['machine'], [QUADS], ['adductor', 'hip adduction machine'], ['Control the open'], ['Copenhagen Plank'])
x('Lateral Band Walk', GL, ['band'], [GLUTES], ['band walks', 'monster walks', 'lateral band walks'], ['Stay low, toes forward'], ['Hip Abduction'])
x('Cable Kickback', GL, ['cable'], [GLUTES], ['glute kickback', 'cable glute kickback', 'kickbacks'], ['Kick back and slightly out, squeeze'], ['Hip Thrust'])
x('Copenhagen Plank', CO, ['bench'], [CORE, QUADS], ['copenhagen', 'copenhagen plank'], ['Top leg on the bench, hips up'], ['Side Plank'])

# ---------- conditioning ----------
x('Run', CN, ['none'], [FULL], ['running', 'jog', 'sprint', 'sprints', '400m run', 'run 400m'], ['Relaxed shoulders, quick light steps'], ['Row', 'Bike'])
x('Row', CN, ['rower'], [FULL], ['rowing', 'row erg', 'erg', 'concept 2 row', 'rower'], ['Legs, body, arms; arms, body, legs', 'Push with the legs, do not just pull'], ['Bike', 'Ski Erg'])
x('Bike', CN, ['bike'], [QUADS, FULL], ['assault bike', 'echo bike', 'air bike', 'bike erg', 'cycle', 'airdyne'], ['Push and pull with arms and legs'], ['Row', 'Run'])
x('Ski Erg', CN, ['ski'], [LATS, CORE, FULL], ['ski', 'skierg', 'ski erg'], ['Hinge and drive the handles down past the hips'], ['Row'])
x('Jump Rope', CN, ['rope'], [CALVES], ['single unders', 'singles', 'jump rope'], ['Small bounces, wrists turn the rope'], ['Double-Unders'])
x('Double-Unders', CN, ['rope'], [CALVES], ['double unders', 'dus', 'du'], ['Tall, small jumps, fast wrists'], ['Jump Rope'])
x('Burpee', CN, ['bodyweight'], [FULL], ['burpees', 'up downs', 'burpee box jump over', 'bar facing burpee'], ['Chest to the floor, jump and clap overhead'], ['Mountain Climber'])
x('Mountain Climber', CN, ['bodyweight'], [CORE, FULL], ['mountain climbers'], ['Hips low, drive the knees fast'], ['Burpee'])
x('Ball Slam', CN, ['medball'], [FULL, CORE], ['ball slams', 'slam balls', 'slam ball', 'med ball slam', 'lateral jump ball slam'], ['Reach tall, slam with the whole body'], ['Burpee'])
x('Battle Ropes', CN, ['ropes'], [DELTS, FULL], ['battle rope', 'ropes'], ['Athletic stance, waves from the shoulders'], ['Ball Slam'])
x('Shuttle Run', CN, ['none'], [FULL], ['shuttle runs', 'shuttle sprint'], ['Low turns, touch the line'], ['Run'])
x('Swim', CN, ['pool'], [FULL], ['swimming'], [], ['Row'])
x('Walk', CN, ['none'], [FULL], ['walking', 'incline walk', 'ruck', 'rucking'], [], ['Bike'])

# ---------- plyo ----------
x('Box Jump', PY, ['box'], [QUADS, GLUTES], ['box jumps', 'seated box jumps', 'box jump over'], ['Swing the arms, land soft in a quarter squat', 'Step down'], ['Broad Jump', 'Squat Jump'])
x('Broad Jump', PY, ['bodyweight'], [QUADS, GLUTES], ['broad jumps', 'standing long jump'], ['Jump out, stick the landing'], ['Box Jump'])
x('Squat Jump', PY, ['bodyweight'], [QUADS, GLUTES], ['jump squat', 'jump squats', 'back squat jump', 'prisoner squat jump', 'squat jumps'], ['Quarter squat, explode, land soft'], ['Box Jump'])
x('Lunge Jump', PY, ['bodyweight'], [QUADS], ['jumping lunges', 'split jumps'], ['Switch legs in the air, land soft'], ['Walking Lunge'])
x('Medicine Ball Throw', PY, ['medball'], [FULL], ['med ball throw', 'medicine ball chest pass', 'rotational med ball throw'], ['Drive from the hips'], ['Ball Slam'])

# ---------- mobility ----------
x('Couch Stretch', MO, ['bodyweight'], [QUADS], ['couch stretch'], ['Squeeze the glute of the back leg'], ['Kneeling Hip Flexor Stretch'])
x('Pigeon Stretch', MO, ['bodyweight'], [GLUTES], ['pigeon', 'pigeon pose'], ['Square the hips, breathe into it'], ['Figure-4 Stretch'])
x('World’s Greatest Stretch', MO, ['bodyweight'], [FULL], ['worlds greatest stretch', 'world greatest stretch'], ['Lunge, elbow to the instep, rotate open'], ['Couch Stretch'])
x('Foam Roll', MO, ['foam roller'], [FULL], ['foam rolling', 'foam roll hamstrings and calves', 'foam roller'], ['Slow passes, pause on tight spots'], [])
x('Pancake Stretch', MO, ['bodyweight'], [HAMS], ['pancake', 'pancake pulses', 'pancake hold', 'pancake hold with contract relax'], ['Hinge forward from the hips'], ['Pigeon Stretch'])
x('Cat-Cow', MO, ['bodyweight'], [BACK], ['cat cow', 'cat camel'], ['Move one segment at a time'], [])
x('90/90 Hip Switch', MO, ['bodyweight'], [GLUTES], ['90 90', '90/90', 'hip 90 90'], ['Sit tall, rotate the knees side to side'], ['Pigeon Stretch'])
x('Thoracic Rotation', MO, ['bodyweight'], [BACK], ['open book', 't spine rotation', 'thoracic rotations'], ['Hips still, rotate the upper back'], ['Cat-Cow'])
x('Kneeling Hip Flexor Stretch', MO, ['bodyweight'], [QUADS], ['hip flexor stretch', 'half kneeling hip flexor stretch'], ['Tuck the pelvis, squeeze the glute'], ['Couch Stretch'])
x('Figure-4 Stretch', MO, ['bodyweight'], [GLUTES], ['figure 4 stretch', 'figure four'], ['Ankle over the opposite knee, pull it in'], ['Pigeon Stretch'])

# ---------- output ----------
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower().replace('’', '')).strip('-')
names = {e['name'] for e in E}
out, seen = [], set()
for e in E:
    e['id'] = slug(e['name'])
    assert e['id'] not in seen, e['id']; seen.add(e['id'])
    e['swaps'] = [s for s in e['swaps'] if s in names]
    e['aliases'] = sorted(set(a for a in e['aliases'] if a.lower() != e['name'].lower()))
    out.append({k: v for k, v in e.items() if v not in ([], '')})
path = os.path.join(os.path.dirname(__file__), '..', 'exercises.json')
json.dump({'v': 1, 'exercises': out}, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(out), 'exercises,', sum(1 for e in out if e.get('cues')), 'with cues ->', os.path.normpath(path))
