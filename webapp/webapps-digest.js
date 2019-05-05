"use strict";

function Digest(files, checksums, defaultAlgorithm, compareValue, callback, progress) {
	if (!files || files.length == 0)
		return;

	var reader = new FileReader(),
		readBinaryString = (typeof reader.readAsBinaryString !== 'undefined'),
		sliceSize = readBinaryString ? (10 * 1024 * 1024) : (64 * 1024), // FileReader will read 10Mo (binary) or 64Ko (buffer) on each loop
		totalSize = $.makeArray(files).reduce(function(cumul, file) { return cumul + file.size; }, 0),
		doneSize = 0,
		fileIndex = 0,
		fileOffset,
		fileAlgorithm,
		fileDigest,
		fileExpectedValue;

	function digestResult(event) {
		// event.target.result est :
		// - readAsDataURL: une chaine du type "data:text/plain;base64,dGVzdA0KYWJjDQojgCE="
		// - readAsArrayBuffer : un ArrayBuffer
		// - readAsBinaryString : une chaine binaire (pas très lisible)
		// - readAsText : une chaine (UTF-8 par défaut mais readAsText a un 2ème param)
		var result = event.target.result, resultSize;
		if (readBinaryString) {
			fileDigest.update(result, 'raw');
			resultSize = result.length;
		} else {
			var array = new Uint8Array(result);
			//fileDigest.update(forge.util.binary.raw.encode(array));
			fileDigest.update(String.fromCharCode.apply(null, array));
			resultSize = array.length;
		}
		// Update progress
		doneSize += resultSize;
		if (progress)
			progress.onprogress(doneSize, totalSize);
		// Move forward
		fileOffset += resultSize;
		if (fileOffset < files[fileIndex].size)
			digestNextSlice();
		else {
			var value = fileDigest.digest().toHex();
			callback(files[fileIndex], fileAlgorithm, value, fileExpectedValue);
			fileIndex++;
			if (fileIndex < files.length)
				digestNextFile();
			else {
				// DONE !
				if (progress)
					progress.onstop();
			}
		}
	}

	function digestNextSlice() {
		var slice = files[fileIndex].slice(fileOffset, fileOffset + sliceSize);
		if (readBinaryString)
			reader.readAsBinaryString(slice);
		else
			reader.readAsArrayBuffer(slice);
	}

	function digestNextFile() {
		var checksum = checksums[files[fileIndex].name];
		if (checksum) {
			fileAlgorithm = checksum.algorithm;
			fileExpectedValue = checksum.checksum;
		} else {
			fileAlgorithm = defaultAlgorithm;
			fileExpectedValue = compareValue;
		}
		fileDigest = forge.md[fileAlgorithm].create();
		fileDigest.start();
		fileOffset = 0;
		digestNextSlice();
	}

	reader.onload = digestResult;
	reader.onerror = function(event) {
		console.log('Erreur sur la lecture du fichier ' + files[fileIndex].name);
		console.log(event);
	};
	if (progress)
		progress.onstart();
	digestNextFile();
}

/**
 * Classe responsable de l'affichage de la progression.
 * 
 * NB : on n'utilise pas les classes de Bootstrap "progress" et "progress-bar" car le dessin fait perdre un temps non négligeable (par exemple : 8.8s -> 10.8s).
 * Si toutefois on le voulait, il suffirait d'ajouter les classes aux 2 div et de retirer le style dans la feuille CSS.
 */
function Progress(progressBar) {
	var progressPct, progressInterval;
	function refresh() {
		progressBar.attr('aria-valuenow', progressPct.toFixed(0)).css('width', progressPct + '%').html('&nbsp;' + progressPct.toFixed(0) + '%');
	}
	this.onstart = function() {
		progressBar.attr('aria-valuenow', '0').css('width', '0').html('');
		progressBar.parent().show();
		progressPct = 0;
		progressInterval = setInterval(refresh, 200);
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
			var fields = line.trim().split(' ');
			if (fields.length === 2) {
				var checksum = fields[0];
				var filename = cleanFileName(fields[1]);
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
	var digestAlgorithms = [];
	digestAlgorithms.push({name: 'md5', title: 'MD5'});
	digestAlgorithms.push({name: 'sha1', title: 'SHA-1', isDefault: true });
	digestAlgorithms.push({name: 'sha256', title: 'SHA-256'});
	digestAlgorithms.push({name: 'sha384', title: 'SHA-384'});
	digestAlgorithms.push({name: 'sha512', title: 'SHA-512'});

	$('#digest-algorithm-menu').append($.map(digestAlgorithms, function(digest, index) {
		if (digest.isDefault)
			$('#digest-algorithm-button span').text(digest.title);
		return $('<button type="button" class="dropdown-item" />').attr('data-algorithm', digest.name).text(digest.title).toggleClass('active', !!digest.isDefault)[0];
	})).on('click', '.dropdown-item', function(event) {
		var button = $(event.target).closest('button');
		button.addClass('active').siblings().removeClass('active');
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
		var compareValue = this.value.toLowerCase();
		$('#digest-table td.result').each(function(index) {
			$(this).parent()
				.toggleClass('table-success', !!compareValue && (this.innerHTML === compareValue))
				.toggleClass('table-danger', !!compareValue && (this.innerHTML !== compareValue));
		});
	}).on('focus', function() {
		$('.dropdown, #digest-files-button, #digest-download-button, #digest-clear-button').hide();
		$('#digest-compare-input').animate({'width': '100%'});
	}).on('blur', function() {
		$('#digest-compare-input').css('width', '');
		$('.dropdown, #digest-files-button, #digest-download-button, #digest-clear-button').fadeIn();
	});

	$('#digest-download-button').on('click', function() {
		var text = $('#digest-table tbody tr').map(function(index) {
			var self = $(this);
			return self.children('.result')[0].innerHTML + '\t' + self.children()[0].innerHTML;
		}).get().join('\n');

		$(this).attr('download', 'CHECKUMS.' + $('#digest-algorithm-menu .active').attr('data-algorithm'))
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
		$('<tr />')
			.data('result', result)
			.toggleClass('table-danger', (result.expectedHash !== '') && (result.hash !== result.expectedHash.toLowerCase()))
			.toggleClass('table-success', (result.expectedHash !== '') && (result.hash === result.expectedHash.toLowerCase()))
			.append('<td>' + result.name + '</td>')
			.append('<td>' + formatFileSize(result.size) + '</td>')
			.append('<td>' + digestAlgorithms.filter(function(a) { return a.name === result.algorithm; })[0].title + '</td>')
			.append('<td class="result">' + result.hash + '</td>')
			.appendTo(tbody);
	}

	function digestFiles(files) {
		// Récupérer les checksums dans les fichiers, si disponibles
		extractChecksums(files, digestAlgorithms.map(function(a) { return a.name; }), function(results) {
			//console.log(results);

			// Une fois récupéré ce qu'on peut, commencer à vérifier les fichiers
			var tbody = $('#digest-table tbody'),
				progressBar = $('#digest-progress').children(),
				algorithm = $('#digest-algorithm-menu .active').attr('data-algorithm'),
				compareValue = $('#digest-compare-input').val();

			new Digest(files, results, algorithm, compareValue, function(file, algorithm, hash, expectedHash) {
				showResult(tbody, {name: file.name, size: file.size, algorithm: algorithm, hash: hash, expectedHash: expectedHash});
			}, new Progress(progressBar));
		});
	}
});

