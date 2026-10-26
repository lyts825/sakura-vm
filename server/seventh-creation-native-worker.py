"""Fixed JSON-only training, integer solving and document tools; no user code loading."""
import base64
import hashlib
import io
import json
import math
import numbers
import os
import sys
import time
import warnings

MAX_INPUT = 16 * 1024 * 1024

def fail(code):
    raise ValueError(code)

def finite(value):
    if isinstance(value, bool) or not isinstance(value, numbers.Real) or not math.isfinite(value): fail('NATIVE_FINITE_NUMBER')
    return float(value)

def matrix(value, maximum=50000):
    import numpy as np
    if not isinstance(value, list) or not value or len(value) > maximum: fail('TRAIN_MATRIX_ROWS')
    width = len(value[0])
    if not width or width > 256 or len(value) * width > 2000000: fail('TRAIN_MATRIX_SIZE')
    if any(not isinstance(row, list) or len(row) != width for row in value): fail('TRAIN_MATRIX_SHAPE')
    return np.array([[float('nan') if v is None else finite(v) for v in row] for row in value], dtype=float)

def indices(value, count):
    if not isinstance(value, list) or not value or len(set(value)) != len(value): fail('TRAIN_PARTITION')
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 or v >= count for v in value): fail('TRAIN_PARTITION')
    return value

def prepare_matrix(x, train):
    import numpy as np
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler
    if np.any(np.all(np.isnan(x[train]), axis=0)): fail('TRAIN_EMPTY_COLUMN')
    imputer = SimpleImputer(strategy='mean')
    imputer.fit(x[train])
    filled = imputer.transform(x)
    scaler = StandardScaler().fit(filled[train])
    return scaler.transform(filled), {'means': imputer.statistics_.tolist(), 'centers': scaler.mean_.tolist(), 'scales': scaler.scale_.tolist()}

def export_model(estimator, algorithm, preprocessing, task):
    out = {'schemaVersion': 1, 'algorithm': algorithm, 'task': task, 'preprocessing': preprocessing}
    if algorithm in ('linear', 'ridge', 'logistic'):
        out['coefficients'] = estimator.coef_.tolist()
        out['intercept'] = estimator.intercept_.tolist() if hasattr(estimator.intercept_, 'tolist') else float(estimator.intercept_)
    elif algorithm == 'tree':
        tree = estimator.tree_
        out['nodes'] = [{'left': int(tree.children_left[i]), 'right': int(tree.children_right[i]), 'feature': int(tree.feature[i]), 'threshold': float(tree.threshold[i]), 'values': tree.value[i][0].tolist()} for i in range(tree.node_count)]
    elif algorithm == 'kmeans': out['centers'] = estimator.cluster_centers_.tolist()
    elif algorithm == 'constant':
        if task == 'classification':
            import numpy as np
            winner = estimator.classes_[int(np.argmax(estimator.class_prior_))]
            out['constant'] = [[winner.item() if hasattr(winner, 'item') else winner]]
        else: out['constant'] = estimator.constant_.tolist()
    if hasattr(estimator, 'classes_'): out['classes'] = estimator.classes_.tolist()
    return out

def metrics(y, predictions, task):
    import numpy as np
    if len(y) == 0: fail('TRAIN_EMPTY_METRICS')
    if task == 'regression':
        residual = np.array(predictions, dtype=float) - np.array(y, dtype=float)
        return {'count': len(y), 'mse': float(np.mean(residual ** 2)), 'mae': float(np.mean(abs(residual)))}
    classes = sorted(set(y.tolist()) | set(predictions.tolist()), key=str)
    confusion = [[sum(1 for a, b in zip(y, predictions) if a == actual and b == predicted) for predicted in classes] for actual in classes]
    return {'count': len(y), 'accuracy': float(np.mean(y == predictions)), 'classes': classes, 'confusion': confusion}

def train(data):
    import numpy as np
    import sklearn
    from sklearn.linear_model import LinearRegression, Ridge, LogisticRegression
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.cluster import KMeans
    from sklearn.dummy import DummyRegressor, DummyClassifier
    from sklearn.exceptions import ConvergenceWarning
    x = matrix(data.get('X'))
    task = data.get('task', 'regression')
    if task not in ('regression', 'classification', 'clustering'): fail('TRAIN_TASK')
    train_ids = indices(data.get('trainIndices'), len(x))
    validation = indices(data.get('validationIndices'), len(x)) if task != 'clustering' else []
    test = indices(data.get('testIndices'), len(x)) if data.get('testIndices') else []
    if set(train_ids) & set(validation) or set(train_ids) & set(test) or set(validation) & set(test): fail('TRAIN_PARTITION_OVERLAP')
    if data.get('groups'):
        groups = data['groups']
        if len(groups) != len(x): fail('TRAIN_GROUPS')
        sets = [set(groups[i] for i in domain) for domain in (train_ids, validation, test)]
        if sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2]: fail('TRAIN_ENTITY_LEAKAGE')
    if task == 'classification':
        labels = data.get('y')
        if not isinstance(labels, list) or any(isinstance(v, bool) or not isinstance(v, (str, int, float)) or (not isinstance(v, str) and not math.isfinite(v)) for v in labels): fail('TRAIN_LABEL_TYPE')
        if len(set('string' if isinstance(v, str) else 'number' for v in labels)) > 1: fail('TRAIN_MIXED_LABEL_TYPES')
    y = None if task == 'clustering' else np.asarray(data.get('y'))
    if y is not None and (y.ndim != 1 or len(y) != len(x)): fail('TRAIN_LABELS')
    if task == 'regression': y = np.array([finite(v) for v in y], dtype=float)
    candidates = data.get('candidates', [{'algorithm': 'linear'}])
    if not isinstance(candidates, list) or not candidates or len(candidates) > 32: fail('TRAIN_CANDIDATE_LIMIT')
    folds = int(data.get('folds', 1))
    actual_training_count = len(candidates) * (folds + 1 if folds > 1 else 1)
    if folds < 1 or folds > 5 or actual_training_count > 80 or folds > len(train_ids): fail('TRAIN_EXPANDED_LIMIT')
    candidate_ids = [str(candidate.get('id', index)) for index, candidate in enumerate(candidates)]
    if len(set(candidate_ids)) != len(candidate_ids): fail('TRAIN_CANDIDATE_ID')
    transformed, preprocessing = prepare_matrix(x, train_ids)
    results = []
    executed_training_count = 0
    seed = int(data.get('seed', 0))
    def fit_candidate(position, candidate):
        nonlocal executed_training_count
        algorithm = candidate.get('algorithm')
        if algorithm == 'linear' and task == 'regression': estimator = LinearRegression(n_jobs=1)
        elif algorithm == 'ridge' and task == 'regression': estimator = Ridge(alpha=finite(candidate.get('alpha', 1)))
        elif algorithm == 'logistic' and task == 'classification':
            iterations = int(candidate.get('maxIterations', 1000))
            if iterations < 1 or iterations > 1000: fail('TRAIN_ITERATION_LIMIT')
            estimator = LogisticRegression(C=finite(candidate.get('C', 1)), max_iter=iterations, random_state=seed)
        elif algorithm == 'tree' and task == 'classification': estimator = DecisionTreeClassifier(max_depth=max(1, min(16, int(candidate.get('maxDepth', 4)))), random_state=seed)
        elif algorithm == 'kmeans' and task == 'clustering': estimator = KMeans(n_clusters=max(2, min(32, int(candidate.get('k', 2)))), random_state=seed, n_init=10, max_iter=300)
        elif algorithm == 'constant': estimator = DummyRegressor(strategy='mean') if task == 'regression' else DummyClassifier(strategy='most_frequent')
        else: fail('TRAIN_ALGORITHM_TASK')
        started = time.monotonic()
        fold_results = []
        if folds > 1:
            if task == 'clustering': fail('TRAIN_CLUSTERING_FOLD_UNSUPPORTED')
            from sklearn.base import clone
            from sklearn.model_selection import KFold, StratifiedKFold, GroupKFold, TimeSeriesSplit
            members = np.array(train_ids)
            if data.get('groups'):
                splitter = GroupKFold(n_splits=folds)
                splits = splitter.split(members, y[members], np.asarray(data['groups'])[members])
            elif data.get('splitStrategy') == 'time':
                splitter = TimeSeriesSplit(n_splits=folds)
                splits = splitter.split(members)
            elif task == 'classification':
                splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
                splits = splitter.split(members, y[members])
            else:
                splitter = KFold(n_splits=folds, shuffle=True, random_state=seed)
                splits = splitter.split(members)
            for fold_index, (fit_positions, check_positions) in enumerate(splits):
                fit_members = members[fit_positions].tolist(); check_members = members[check_positions].tolist()
                fold_x, fold_preprocessing = prepare_matrix(x, fit_members)
                fold_estimator = clone(estimator)
                with warnings.catch_warnings(record=True) as fold_warnings:
                    warnings.simplefilter('always')
                    executed_training_count += 1
                    fold_estimator.fit(fold_x[fit_members], y[fit_members])
                fold_prediction = fold_estimator.predict(fold_x[check_members])
                fold_results.append({'fold': fold_index, 'trainingIndices': fit_members, 'validationIndices': check_members, 'preprocessing': fold_preprocessing, 'metrics': metrics(y[check_members], fold_prediction, task), 'converged': not any(issubclass(item.category, ConvergenceWarning) for item in fold_warnings), 'warnings': [{'category': item.category.__name__, 'message': str(item.message)[:1024]} for item in fold_warnings[:32]]})
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter('always')
            executed_training_count += 1
            estimator.fit(transformed[train_ids], y[train_ids] if y is not None else None)
        converged = not any(issubclass(item.category, ConvergenceWarning) for item in captured) and all(fold['converged'] for fold in fold_results)
        model = export_model(estimator, algorithm, preprocessing, task)
        if task == 'clustering':
            pred = estimator.predict(transformed)
            counts = [int(np.sum(pred == cluster)) for cluster in range(len(estimator.cluster_centers_))]
            measure = {'count': len(x), 'inertia': float(estimator.inertia_), 'clusterCounts': counts, 'emptyClusters': [cluster for cluster, count in enumerate(counts) if count == 0]}
            converged = converged and not measure['emptyClusters']
        else:
            pred = estimator.predict(transformed[validation])
            measure = metrics(y[validation], pred, task)
        selection_metrics = measure if not fold_results else {key: float(np.mean([fold['metrics'][key] for fold in fold_results])) for key in (('mse', 'mae') if task == 'regression' else ('accuracy',))}
        return {'id': str(candidate.get('id', position)), 'model': model, 'metrics': measure, 'selectionMetrics': selection_metrics, 'folds': fold_results, 'validationPredictions': pred.tolist(), 'elapsedMs': round((time.monotonic() - started) * 1000, 3), 'state': 'completed' if converged else 'not-converged', 'converged': bool(converged), 'warnings': [{'category': item.category.__name__, 'message': str(item.message)[:1024]} for item in captured[:32]]}
    for position, candidate in enumerate(candidates):
        try: results.append(fit_candidate(position, candidate))
        except Exception as error:
            results.append({'id': str(candidate.get('id', position)), 'state': 'failed', 'error': {'code': str(error)[:2000], 'type': type(error).__name__}})
    score = (lambda r: r['selectionMetrics']['mse']) if task == 'regression' else ((lambda r: -r['selectionMetrics']['accuracy']) if task == 'classification' else (lambda r: r['selectionMetrics']['inertia']))
    eligible = [candidate for candidate in results if candidate['state'] == 'completed']
    selected = sorted(eligible, key=lambda r: (score(r), r['id']))[0] if eligible else None
    state = 'completed' if len(eligible) == len(results) else ('partial' if eligible else 'failed')
    return {'tool': {'python': sys.version.split()[0], 'sklearn': sklearn.__version__}, 'task': task, 'trainingIndices': train_ids, 'validationIndices': validation, 'testIndices': test, 'testUsedForSelection': False, 'candidates': results, 'selectedId': selected['id'] if selected else None, 'actualTrainingCount': executed_training_count, 'plannedTrainingCount': actual_training_count, 'trainingDigest': hashlib.sha256(json.dumps(data['X'], separators=(',', ':')).encode()).hexdigest(), 'state': state}

def predict(data):
    import numpy as np
    x = matrix(data.get('X'))
    model = data.get('model', {})
    if model.get('schemaVersion') != 1: fail('MODEL_SCHEMA')
    pre = model.get('preprocessing', {})
    means = np.array(pre.get('means'), dtype=float)
    centers = np.array(pre.get('centers'), dtype=float)
    scales = np.array(pre.get('scales'), dtype=float)
    if any(a.shape != (x.shape[1],) or not np.isfinite(a).all() for a in (means, centers, scales)) or np.any(scales <= 0): fail('MODEL_PREPROCESSING')
    z = (np.where(np.isnan(x), means, x) - centers) / scales
    algorithm = model.get('algorithm')
    probabilities = None
    if algorithm in ('linear', 'ridge'): values = z @ np.array(model['coefficients']) + finite(model['intercept'])
    elif algorithm == 'logistic':
        coefficients = np.array(model['coefficients'], dtype=float)
        logits = z @ coefficients.T + np.array(model['intercept'])
        if logits.shape[1] == 1:
            positive = 1 / (1 + np.exp(-np.clip(logits[:, 0], -700, 700)))
            probabilities = np.column_stack([1 - positive, positive])
        else:
            scores = np.exp(logits - logits.max(axis=1, keepdims=True)); probabilities = scores / scores.sum(axis=1, keepdims=True)
        values = np.array(model['classes'])[probabilities.argmax(axis=1)]
    elif algorithm == 'kmeans':
        c = np.array(model['centers'], dtype=float)
        values = ((z[:, None, :] - c[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
    elif algorithm == 'constant': values = np.repeat(np.array(model['constant']).flat[0], len(z))
    elif algorithm == 'tree':
        nodes = model.get('nodes')
        if not isinstance(nodes, list) or not nodes or len(nodes) > 100000: fail('MODEL_TREE_LIMIT')
        output = []
        for row in z:
            node = 0; visited = set()
            while True:
                if node in visited or not isinstance(node, int) or node < 0 or node >= len(nodes): fail('MODEL_TREE_CYCLE')
                visited.add(node); n = nodes[node]
                if n['left'] == -1 and n['right'] == -1:
                    output.append(model['classes'][int(np.argmax(n['values']))]); break
                feature = int(n['feature'])
                if feature < 0 or feature >= len(row): fail('MODEL_TREE_FEATURE')
                node = n['left'] if row[feature] <= finite(n['threshold']) else n['right']
        values = np.asarray(output)
    else: fail('MODEL_ALGORITHM')
    return {'predictions': values.tolist(), 'probabilities': probabilities.tolist() if probabilities is not None else None, 'count': len(values), 'modelDigest': hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()}

def solve(data):
    import numpy as np
    import scipy
    from scipy.optimize import milp, Bounds, LinearConstraint
    variables = data.get('variables')
    constraints = data.get('constraints', [])
    if not isinstance(variables, list) or not variables or len(variables) > 5000 or len(constraints) > 20000: fail('SOLVE_SIZE')
    ids = [v['id'] for v in variables]
    if len(set(ids)) != len(ids): fail('SOLVE_DUPLICATE_VARIABLE')
    index = {v: i for i, v in enumerate(ids)}
    lower = [finite(v.get('min', 0)) for v in variables]
    upper = [finite(v.get('max', 1)) for v in variables]
    if any(a > b or not a.is_integer() or not b.is_integer() for a, b in zip(lower, upper)): fail('SOLVE_DOMAIN')
    objective = data.get('objective', {})
    terms = objective.get('terms', {})
    c = np.zeros(len(ids))
    for name, value in terms.items():
        if name not in index: fail('SOLVE_UNKNOWN_VARIABLE')
        c[index[name]] = finite(value)
    maximize = objective.get('direction', 'min') == 'max'
    coefficients = []; lbs = []; ubs = []
    for constraint in constraints:
        row = np.zeros(len(ids))
        for name, value in constraint['terms'].items():
            if name not in index: fail('SOLVE_UNKNOWN_VARIABLE')
            row[index[name]] = finite(value)
        rhs = finite(constraint['rhs']); op = constraint['op']
        coefficients.append(row); lbs.append(rhs if op in ('eq', 'gte') else -np.inf); ubs.append(rhs if op in ('eq', 'lte') else np.inf)
        if op not in ('eq', 'gte', 'lte'): fail('SOLVE_OPERATOR')
    result = milp(-c if maximize else c, integrality=np.ones(len(ids)), bounds=Bounds(lower, upper), constraints=LinearConstraint(np.array(coefficients), lbs, ubs) if coefficients else None, options={'time_limit': min(120, max(1, finite(data.get('timeoutSeconds', 30)))), 'node_limit': 1000000})
    assignment = {name: int(round(result.x[i])) for name, i in index.items()} if result.x is not None else None
    verified = None
    if assignment is not None:
        checks = []
        for v in variables:
            checks.append(v.get('min', 0) <= assignment[v['id']] <= v.get('max', 1))
        for constraint in constraints:
            lhs = sum(finite(value) * assignment[name] for name, value in constraint['terms'].items()); rhs = finite(constraint['rhs'])
            checks.append(abs(lhs-rhs) <= 1e-8 if constraint['op'] == 'eq' else (lhs <= rhs+1e-8 if constraint['op'] == 'lte' else lhs >= rhs-1e-8))
        verified = all(checks)
        if not verified: fail('SOLVE_CANDIDATE_INVALID')
    states = {0: 'optimal', 1: 'feasible' if assignment else 'unknown', 2: 'infeasible', 3: 'unbounded', 4: 'unknown'}
    bound = getattr(result, 'mip_dual_bound', None)
    return {'state': states.get(result.status, 'unknown'), 'assignment': assignment, 'verified': verified, 'objective': sum(c[i]*assignment[name] for name, i in index.items()) if assignment else None, 'bound': float(-bound if maximize else bound) if bound is not None and math.isfinite(bound) else None, 'message': str(result.message), 'tool': {'python': sys.version.split()[0], 'scipy': scipy.__version__}}

def extract(data):
    import pymupdf
    payload = data.get('dataBase64')
    if not isinstance(payload, str): fail('EXTRACT_BYTES')
    raw = base64.b64decode(payload, validate=True)
    if len(raw) > 128 * 1024 * 1024: fail('EXTRACT_INPUT_LIMIT')
    mode = data.get('mode', 'text')
    fmt = data.get('format', 'pdf')
    pages = []
    if fmt == 'pdf':
        doc = pymupdf.open(stream=raw, filetype='pdf')
        if doc.needs_pass: fail('EXTRACT_ENCRYPTED_PDF')
        if len(doc) > 200: fail('EXTRACT_PAGE_LIMIT')
        for position, page in enumerate(doc):
            rect = page.rect
            if rect.width * rect.height > 40000000: fail('EXTRACT_PIXEL_LIMIT')
            content = page.get_text('dict')
            lines = []
            for block in content.get('blocks', []):
                for line in block.get('lines', []):
                    for span in line.get('spans', []): lines.append({'text': span.get('text', ''), 'bbox': list(span['bbox']), 'source': 'text-layer'})
            if mode == 'ocr':
                if math.ceil(rect.width * 2) * math.ceil(rect.height * 2) > 40000000: fail('EXTRACT_PIXEL_LIMIT')
                pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
                lines = ocr_image(pix.tobytes('png'), data)
                for line in lines: line['bbox'] = [v / 2 for v in line['bbox']]
            pages.append({'id': f'page-{position+1}', 'page': position+1, 'width': rect.width, 'height': rect.height, 'rotation': page.rotation, 'spans': lines, 'text': '\n'.join(line['text'] for line in lines)})
        doc.close()
    elif fmt in ('png', 'jpeg'):
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        if img.width*img.height > 40000000: fail('EXTRACT_PIXEL_LIMIT')
        if mode != 'ocr': fail('EXTRACT_IMAGE_REQUIRES_OCR')
        lines = ocr_image(raw, data)
        pages.append({'id': 'page-1', 'page': 1, 'width': img.width, 'height': img.height, 'rotation': 0, 'spans': lines, 'text': '\n'.join(line['text'] for line in lines)})
    else: fail('EXTRACT_FORMAT')
    return {'pages': pages, 'digest': hashlib.sha256(raw).hexdigest(), 'tool': {'python': sys.version.split()[0], 'pymupdf': pymupdf.VersionBind}, 'mode': mode, 'state': 'completed'}

def ocr_image(raw, data):
    from PIL import Image
    import pytesseract
    # The executable is a fixed sibling in the admitted runtime, never a request path.
    candidate = os.path.join(os.path.dirname(sys.executable), 'tesseract', 'tesseract.exe')
    if os.name == 'nt': pytesseract.pytesseract.tesseract_cmd = candidate
    lang = data.get('language', 'eng')
    if lang not in ('eng',): fail('EXTRACT_LANGUAGE_UNSUPPORTED')
    result = pytesseract.image_to_data(Image.open(io.BytesIO(raw)), lang=lang, config='--psm 6', output_type=pytesseract.Output.DICT, timeout=60)
    spans = []
    for i, value in enumerate(result['text']):
        if not value.strip(): continue
        left = int(result['left'][i]); top = int(result['top'][i]); width = int(result['width'][i]); height = int(result['height'][i])
        spans.append({'text': value, 'bbox': [left, top, left+width, top+height], 'confidence': float(result['conf'][i]), 'source': 'ocr'})
    return spans

def probe(data):
    import socket
    result = {}
    try:
        with open(data['outsidePath'], 'rb') as f: f.read(1)
        result['outsideReadDenied'] = False
    except (OSError, PermissionError): result['outsideReadDenied'] = True
    try:
        s = socket.socket(); s.settimeout(2); s.connect(('127.0.0.1', int(data['port'])));s.close();result['networkDenied'] = False
    except OSError: result['networkDenied'] = True
    with open('owned-probe.txt', 'w') as f: f.write('owned')
    result['ownedWrite'] = True
    if data.get('runtimeFile'):
        try:
            with open(data['runtimeFile'], 'a') as f: f.write('unexpected')
            result['runtimeWriteDenied'] = False
        except (OSError, PermissionError): result['runtimeWriteDenied'] = True
    return result

def main():
    raw = sys.stdin.buffer.read(MAX_INPUT+1)
    if len(raw) > MAX_INPUT: fail('NATIVE_INPUT_LIMIT')
    request = json.loads(raw)
    action = request.get('action')
    data = request.get('input', {})
    if action == 'train': result = train(data)
    elif action == 'predict': result = predict(data)
    elif action == 'solve': result = solve(data)
    elif action == 'extract': result = extract(data)
    elif action == 'probe': result = probe(data)
    else: fail('NATIVE_ACTION')
    print(json.dumps({'ok': True, 'result': result}, allow_nan=False, separators=(',', ':')))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'ok': False, 'code': str(error), 'type': type(error).__name__}, separators=(',', ':')))
        sys.exit(1)
