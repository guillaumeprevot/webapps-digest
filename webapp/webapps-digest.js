"use strict";

/**
 * Classe responsable de l'affichage de la progression.
 *
 * NB : on n'utilise pas les classes de Bootstrap "progress" et "progress-bar" car le dessin fait perdre un temps non négligeable (par exemple : 8.8s -> 10.8s).
 * Si toutefois on le voulait, il suffirait d'ajouter les classes aux 2 div et de retirer le style dans la feuille CSS.
 */
function Progress(progressBar) {
	var progressPct, progressInterval;
	function refresh() {
		progressBar.attr('aria-valuenow', progressPct.toFixed(0))
			.css('width', progressPct + '%')
			.html('&nbsp;' + progressPct.toFixed(0) + '%');
	}
	this.onstart = function() {
		progressBar.attr('aria-valuenow', '0')
			.css('width', '0')
			.html('');
		progressBar.parent().show();
		progressPct = 0;
		progressInterval = setInterval(refresh, 1000);
	};
	this.onprogress = function(done, total) {
		progressPct = done * 100.0 / total;
	};
	this.onstop = function() {
		clearInterval(progressInterval);
		progressInterval = undefined;
		progressPct = undefined;
		progressBar.parent().hide();
	};
}

/**
 * This method search for checksum files (.md5, .sha1, .sha256, ...) and extract checkums from these files.
 * The callback, called when data has been extracted, will receive a single object with file names as key and file infos as properties :
 * {
 *   "bbbbbb.txt":{
 *     "filename":"bbbbbb.txt",
 *     "algorithm":"md5",
 *     "checksum":"875f26fdb1cecf20ceb4ca028263dec6"
 *   },
 *   ...
 * }
 *
 * @param {File[]} files - the list of file
 * @param {String[]} algorithms - the list of checkum file extensions, weaker first, stronger last (['md5', 'sha1', 'sha256'] for instance)
 * @param {Function(results)} callback - the callback to call when data has been extracted
 */
function extractChecksums(files, algorithms, callback) {
	if (!files || files.length == 0)
		return callback({});

	var reader = new FileReader();
	var fileIndex = 0;
	var algorithm = '';
	var results = {};

	function cleanFileName(filename) {
		// Remove optional '*' at the beginning
		if (filename.charAt(0) === '*')
			filename = filename.substring(1);
		// Remove path
		if (filename.lastIndexOf('/') >= 0)
			filename = filename.substring(filename.lastIndexOf('/') + 1);
		return filename;
	}

	function nextChecksumResult(event) {
		// avec readAsText, event.target.result est une chaine (UTF-8 par défaut mais readAsText a un 2ème param)
		var result = event.target.result;
		var fixColumnSeparators = result.replace(/\t/g, ' ').replace(/[ ]+/g, ' ');
		var fixLineSeparators = fixColumnSeparators.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		fixLineSeparators.split('\n').forEach(function(line) {
			var l = line.trim(), i = l.indexOf(' ');
			if (i > 0) {
				var checksum = l.substring(0, i);
				var filename = cleanFileName(l.substring(i + 1));
				var e = results[filename];
				if (!e)
					e = results[filename] = { filename: filename };
				if (!e.algorithm || (algorithms.indexOf(e.algorithm) < algorithms.indexOf(algorithm))) {
					e.algorithm = algorithm;
					e.checksum = checksum;
				}
			}
		})
		fileIndex++;
		if (fileIndex < files.length)
			nextChecksumFile();
		else
			// On finit ici avec le dernier fichier qui est un fichier de checksum
			callback(results);
	}

	function nextChecksumFile() {
		var file, i;
		do {
			file = files[fileIndex]
			i = file.name.lastIndexOf('.');
			algorithm = file.name.substring(i + 1).toLowerCase();
			if (algorithms.indexOf(algorithm) >= 0) {
				reader.readAsText(file);
				break;
			} else {
				fileIndex++;
			}
		} while (fileIndex < files.length);
		// On finit ici si le dernier fichier n'est pas un fichier de checksum
		if (fileIndex === files.length)
			callback(results);
	}

	reader.onload = nextChecksumResult;
	reader.onerror = function(event) {
		console.log('Erreur sur la lecture du fichier de contrôle ' + files[fileIndex].name);
		console.log(event);
	};
	nextChecksumFile();
}

function formatFileSize(size) {
	if (size < 1024)
		return size.toString();
	if (size < 1024 * 1024)
		return (size / 1024).toPrecision(3) + ' Ko';
	if (size < 1024 * 1024 * 1024)
		return (size / 1024 / 1024).toPrecision(3) + ' Mo';
	return (size / 1024 / 1024 / 1024).toPrecision(3) + ' Go';
}

$(function() {
	var digestAlgorithms = [
		{ name: 'md5', title: 'MD5', hashSize: 128, split: false },
		{ name: 'sha1', title: 'SHA-1', hashSize: 160, split: 20 },
		{ name: 'sha256', title: 'SHA-256', hashSize: 256, split: 32, isDefault: true },
		{ name: 'sha384', title: 'SHA-384', hashSize: 384, split: 32 },
		{ name: 'sha512', title: 'SHA-512', hashSize: 512, split: 32 }
	];

	var zeroWidthSpaceHTML = '&#8203;';
	var zeroWidthSpaceChar = '\u200B';

	$('#digest-algorithm-menu').append(digestAlgorithms.map((digest, _index) => {
		if (digest.isDefault)
			$('#digest-algorithm-button span').text(digest.title);
		return $('<button type="button" class="dropdown-item" />')
			.attr('data-algorithm', digest.name)
			.text(digest.title)
			.toggleClass('active', !!digest.isDefault)
			.get(0);
	})).on('click', '.dropdown-item', function(event) {
		var button = $(event.target).closest('button');
		button.addClass('active')
			.siblings().removeClass('active');
		$('#digest-algorithm-button span').text(button.text());
		$('#digest-table tbody').empty();
		$('#digest-files-input').trigger('change');
	});

	$('#digest-files-button').on('click', function() {
		$('#digest-files-input').click();
	});

	$('#digest-files-input').on('change', function() {
		digestFiles(this.files);
	});

	$('body').on('dragover', function(event) {
		event.stopPropagation();
		event.preventDefault();
		event.originalEvent.dataTransfer.dropEffect = 'copy';
	}).on('drop', function(event) {
		event.stopPropagation();
		event.preventDefault();
		digestFiles(event.originalEvent.dataTransfer.files);
	});

	$('#digest-compare-input').on('change', function() {
		var compareValue = this.value.toLowerCase().replace(zeroWidthSpaceChar, '');
		$('#digest-table td.result').each(function(_index) {
			var tr = $(this).parent(), result = tr.data('result');
			tr.toggleClass('table-success', !!compareValue && (result.hash === compareValue))
				.toggleClass('table-danger', !!compareValue && (result.hash !== compareValue));
		});
	});

	$('#digest-download-button').on('click', function() {
		var algorithm = $('#digest-algorithm-menu .active').attr('data-algorithm');
		var text = $('#digest-table tbody tr').map(function(_index) {
			var result = $(this).data('result');
			if (result.algorithm === algorithm)
				return result.hash + '\t' + result.name;
		}).get().join('\n');

		$(this).attr('download', 'CHECKUMS.' + algorithm)
			.attr('href', 'data:text/plain;base64,' + forge.util.encode64(text));
	}).toggle('download' in document.createElement('a'));

	$('#digest-clear-button').on('click', function() {
		$('#digest-table tbody').empty();
	});

	$('#digest-table thead th').on('click', function(event) {
		var results = $('#digest-table tbody tr').get().map(function (tr) { return $(tr).data('result'); });
		var tbody = $('#digest-table tbody').empty();
		var field = $(event.target).attr('data-sort');
		var ascending = (tbody.data('sort-field') !== field) || (tbody.data('sort-ascending') === false);
		var compare = (field === 'size') ? function(v1, v2) { return v1-v2; } : function(v1, v2) { return v1.localeCompare(v2); };
		tbody.data('sort-field', field).data('sort-ascending', ascending);
		results.sort(function(r1, r2) { return compare(r1[field], r2[field]); });
		if (!ascending)
			results.reverse();
		results.forEach(function(result) {
			showResult(tbody, result);
		});
	});

	function showResult(tbody, result) {
		var algorithm = digestAlgorithms.filter(function(a) { return a.name === result.algorithm; })[0];
		var h = result.hash;
		if (algorithm.split) {
			var i = result.hash.length - algorithm.split;
			while (i > 0) {
				h = h.substring(0, i) + zeroWidthSpaceHTML + h.substring(i);
				i -= algorithm.split;
			}
		}
		$('<tr />')
			.data('result', result)
			.toggleClass('table-danger', (result.expectedHash !== '') && (result.hash !== result.expectedHash.toLowerCase()))
			.toggleClass('table-success', (result.expectedHash !== '') && (result.hash === result.expectedHash.toLowerCase()))
			.append('<td class="result">' + h + '</td>')
			.append('<td>' + algorithm.title + '</td>')
			.append('<td>' + formatFileSize(result.size) + '</td>')
			.append('<td>' + result.name + '</td>')
			.appendTo(tbody);
	}

	function digestFiles(files) {
		// Récupérer les checksums dans les fichiers, si disponibles
		extractChecksums(files, digestAlgorithms.map(function(a) { return a.name; }), function(results) {
			//console.log(results);

			// Une fois récupéré ce qu'on peut, commencer à vérifier les fichiers
			var tbody = $('#digest-table tbody'),
				progress = new Progress($('#digest-progress').children()),
				algorithm = $('#digest-algorithm-menu .active').attr('data-algorithm'),
				compareValue = $('#digest-compare-input').val().toLowerCase().replace(zeroWidthSpaceChar, '');

			var worker = new Worker('webapps-digest-ww.js');
			worker.postMessage({
				files: files,
				checksums: results,
				defaultAlgorithm: algorithm,
				compareValue: compareValue
			});
			worker.onmessage = function(event) {
				if (event.data.type === 'start') {
					progress.onstart();
				} else if (event.data.type === 'progress') {
					progress.onprogress(event.data.done, event.data.total);
				} else if (event.data.type === 'result') {
					showResult(tbody, { name: event.data.file.name, size: event.data.file.size, algorithm: event.data.algorithm, hash: event.data.hash, expectedHash: event.data.expectedHash});
				} else if (event.data.type === 'stop') {
					progress.onstop();
				} else if (event.data.type === 'error') {
					console.error(event.data.message);
				} else {
					console.log('unexpected message', event.data);
				}
			};
		});
	}
});

